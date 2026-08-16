package com.lyftr.phone.auth

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.time.Instant
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/**
 * One CardioSyncWorker run's outcome, for the "Sync history" list on
 * StatusScreen. Logged for every outcome (not just successes) so the history
 * itself can answer "is this actually working" — see TokenStore.syncLog.
 */
@Serializable
data class SyncLogEntry(
    val at: Long,
    val status: String,
    val imported: Int = 0,
    val updated: Int = 0,
    val found: Int = 0,
)

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
     * Set when a refresh attempt fails (refresh token expired/revoked server-side —
     * see [LyftrApiClient.executeWithRefresh]), whether that happens in the
     * foreground or from a background worker. Persisted so it survives past
     * process death: if the phone app is closed when a background refresh
     * fails, the next launch still lands on a "please sign in again" prompt
     * instead of a silently-stale StatusScreen. Cleared on the next
     * successful login.
     */
    var sessionExpired: Boolean
        get() = prefs.getBoolean(KEY_SESSION_EXPIRED, false)
        set(value) = prefs.edit().putBoolean(KEY_SESSION_EXPIRED, value).apply()

    /**
     * Live signal for the foreground: lets LyftrPhoneApp react immediately
     * (bounce StatusScreen -> LoginScreen) when a background poll/worker
     * expires the session while the app is already open, rather than waiting
     * for the next cold start to notice the persisted [sessionExpired] flag.
     */
    private val _sessionExpiredEvents = MutableStateFlow(0)
    val sessionExpiredEvents = _sessionExpiredEvents.asStateFlow()

    /** Clears the JWT pair and marks the session as expired (distinct from user-initiated [clear] via logout). */
    fun expireSession() {
        prefs.edit()
            .remove(KEY_ACCESS_TOKEN)
            .remove(KEY_REFRESH_TOKEN)
            .putBoolean(KEY_SESSION_EXPIRED, true)
            .apply()
        _sessionExpiredEvents.value += 1
    }

    /**
     * Watermark for CardioSyncWorker: the latest Health Connect session
     * start-time already submitted, so each sync run only reads what's new.
     * Null means "never synced" — read everything Health Connect has.
     */
    var lastCardioSyncAt: Instant?
        get() = prefs.getLong(KEY_LAST_CARDIO_SYNC, -1L).takeIf { it >= 0 }?.let(Instant::ofEpochMilli)
        set(value) = prefs.edit().putLong(KEY_LAST_CARDIO_SYNC, value?.toEpochMilli() ?: -1L).apply()

    /**
     * Last 10 CardioSyncWorker outcomes, newest first — cheap to keep: each
     * run already does a Health Connect query + (on success) a prefs write
     * for [lastCardioSyncAt], so one more small bounded JSON blob in the same
     * file adds negligible overhead on top of that.
     */
    val syncLog: List<SyncLogEntry>
        get() = prefs.getString(KEY_SYNC_LOG, null)
            ?.let { runCatching { Json.decodeFromString(ListSerializer(SyncLogEntry.serializer()), it) }.getOrNull() }
            ?: emptyList()

    fun appendSyncLogEntry(entry: SyncLogEntry) {
        val updated = (listOf(entry) + syncLog).take(10)
        prefs.edit().putString(KEY_SYNC_LOG, Json.encodeToString(ListSerializer(SyncLogEntry.serializer()), updated)).apply()
    }

    fun saveTokens(access: String, refresh: String) {
        prefs.edit()
            .putString(KEY_ACCESS_TOKEN, access)
            .putString(KEY_REFRESH_TOKEN, refresh)
            .apply()
    }

    /**
     * Logs out: drops the JWT pair only. Server URL and remembered
     * credentials survive so the next login is a single tap on a prefilled
     * form (LoginScreen) instead of retyping the server and password. Not an
     * expiry, so [sessionExpired] is left untouched (should already be
     * false in this path).
     */
    fun clear() {
        prefs.edit()
            .remove(KEY_ACCESS_TOKEN)
            .remove(KEY_REFRESH_TOKEN)
            .apply()
    }

    /** Called once a fresh login (or token refresh) succeeds — clears any stale expiry flag. */
    fun clearSessionExpired() {
        if (sessionExpired) prefs.edit().putBoolean(KEY_SESSION_EXPIRED, false).apply()
    }

    private companion object {
        const val KEY_SERVER_URL = "server_url"
        const val KEY_SAVED_EMAIL = "saved_email"
        const val KEY_SAVED_PASSWORD = "saved_password"
        const val KEY_ACCESS_TOKEN = "access_token"
        const val KEY_REFRESH_TOKEN = "refresh_token"
        const val KEY_LAST_CARDIO_SYNC = "last_cardio_sync_at"
        const val KEY_SESSION_EXPIRED = "session_expired"
        const val KEY_SYNC_LOG = "cardio_sync_log"
    }
}
