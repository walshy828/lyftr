package com.lyftr.phone.auth

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.time.Instant

/**
 * Keystore-backed storage for the server URL and JWT pair. The backend has no
 * device/API-key concept (see backend/utils/jwt.go) — an access token expires
 * hourly and the refresh token after 30 days, both stored here so
 * [com.lyftr.phone.auth.TokenRefresher] can rotate them without prompting login
 * on every app restart.
 */
class TokenStore(context: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "lyftr_secure_prefs",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    var serverUrl: String?
        get() = prefs.getString(KEY_SERVER_URL, null)
        set(value) = prefs.edit().putString(KEY_SERVER_URL, value).apply()

    /**
     * Email/password remembered from the last successful login, so
     * LoginScreen can prefill them after a logout or a refresh-token expiry
     * instead of asking the user to retype everything. Stored in the same
     * encrypted prefs as the JWTs, so this adds no new security surface.
     */
    var savedEmail: String?
        get() = prefs.getString(KEY_SAVED_EMAIL, null)
        set(value) = prefs.edit().putString(KEY_SAVED_EMAIL, value).apply()

    var savedPassword: String?
        get() = prefs.getString(KEY_SAVED_PASSWORD, null)
        set(value) = prefs.edit().putString(KEY_SAVED_PASSWORD, value).apply()

    var accessToken: String?
        get() = prefs.getString(KEY_ACCESS_TOKEN, null)
        set(value) = prefs.edit().putString(KEY_ACCESS_TOKEN, value).apply()

    var refreshToken: String?
        get() = prefs.getString(KEY_REFRESH_TOKEN, null)
        set(value) = prefs.edit().putString(KEY_REFRESH_TOKEN, value).apply()

    val isLoggedIn: Boolean
        get() = !serverUrl.isNullOrBlank() && !refreshToken.isNullOrBlank()

    /**
     * Watermark for CardioSyncWorker: the latest Health Connect session
     * start-time already submitted, so each sync run only reads what's new.
     * Null means "never synced" — read everything Health Connect has.
     */
    var lastCardioSyncAt: Instant?
        get() = prefs.getLong(KEY_LAST_CARDIO_SYNC, -1L).takeIf { it >= 0 }?.let(Instant::ofEpochMilli)
        set(value) = prefs.edit().putLong(KEY_LAST_CARDIO_SYNC, value?.toEpochMilli() ?: -1L).apply()

    fun saveTokens(access: String, refresh: String) {
        prefs.edit()
            .putString(KEY_ACCESS_TOKEN, access)
            .putString(KEY_REFRESH_TOKEN, refresh)
            .apply()
    }

    /**
     * Logs out: drops the JWT pair only. Server URL and remembered
     * credentials survive so the next login is a single tap on a prefilled
     * form (LoginScreen) instead of retyping the server and password.
     */
    fun clear() {
        prefs.edit()
            .remove(KEY_ACCESS_TOKEN)
            .remove(KEY_REFRESH_TOKEN)
            .apply()
    }

    private companion object {
        const val KEY_SERVER_URL = "server_url"
        const val KEY_SAVED_EMAIL = "saved_email"
        const val KEY_SAVED_PASSWORD = "saved_password"
        const val KEY_ACCESS_TOKEN = "access_token"
        const val KEY_REFRESH_TOKEN = "refresh_token"
        const val KEY_LAST_CARDIO_SYNC = "last_cardio_sync_at"
    }
}
