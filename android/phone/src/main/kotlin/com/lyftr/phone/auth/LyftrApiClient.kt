package com.lyftr.phone.auth

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

private const val TAG = "LyftrSync"

@Serializable private data class LoginRequest(val email: String, val password: String)
@Serializable private data class RefreshRequest(val refresh_token: String)
@Serializable private data class AuthData(val token: String, val refresh_token: String)
@Serializable private data class AuthEnvelope(val data: AuthData)
@Serializable private data class PutActiveSessionRequest(val data: String)
@Serializable private data class ActiveSessionData(val data: String? = null, val updated_at: String? = null)
@Serializable private data class ActiveSessionEnvelope(val data: ActiveSessionData? = null)

/**
 * Mirrors backend/models/models.go's CreateSetReq/CreateWorkoutExerciseReq/
 * CreateWorkoutRequest — the shape POST /api/v1/workouts expects. Kept as
 * typed, one-way outbound DTOs (unlike SessionRepository's raw JsonObject
 * tree, which deliberately avoids typed round-tripping): nothing reads these
 * back, so there's no risk of silently dropping a field the phone doesn't
 * know about.
 */
@Serializable
data class CreateSetReq(
    val set_number: Int,
    val reps: Int,
    val weight: Double,
    val completed: Boolean,
)

@Serializable
data class CreateWorkoutExerciseReq(
    val exercise_id: Long,
    val order_index: Int,
    val rest_seconds: Int,
    val sets: List<CreateSetReq>,
)

@Serializable
data class CreateWorkoutRequest(
    val name: String,
    val duration: Int,
    val started_at: String,
    val program_id: Long? = null,
    /** 0 = unrated, 1 = light, 2 = moderate, 3 = intense. */
    val feeling: Int = 0,
    val exercises: List<CreateWorkoutExerciseReq>,
)

/**
 * Minimal REST client for the subset of the Lyftr API (backend/routes/routes.go)
 * the phone companion needs: login/refresh and the active-session blob sync
 * (backend/controllers/active_session.go). No offline queueing — per the
 * companion's scope, a lost connection just means the next poll/PUT retries.
 */
class LyftrApiClient(private val tokenStore: TokenStore) {
    private val http = OkHttpClient()
    private val json = Json { ignoreUnknownKeys = true }

    private fun apiUrl(path: String) =
        "${tokenStore.serverUrl!!.trimEnd('/')}/api/v1$path"

    /** Validates a self-hosted server URL via the public /api/v1/info probe. */
    suspend fun checkServer(url: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder().url("${url.trimEnd('/')}/api/v1/info").build()
            http.newCall(req).execute().use { it.isSuccessful }
        } catch (e: IOException) {
            false
        }
    }

    suspend fun login(email: String, password: String): Boolean = withContext(Dispatchers.IO) {
        val body = json.encodeToString(LoginRequest.serializer(), LoginRequest(email, password))
            .toRequestBody(JSON_MEDIA_TYPE)
        val req = Request.Builder().url(apiUrl("/auth/login")).post(body).build()
        runCatching {
            http.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext false
                val envelope = json.decodeFromString(AuthEnvelope.serializer(), resp.body!!.string())
                tokenStore.saveTokens(envelope.data.token, envelope.data.refresh_token)
                true
            }
        }.getOrDefault(false)
    }

    /** Rotates the token pair using the stored refresh token. See backend/utils/jwt.go. */
    suspend fun refresh(): Boolean = withContext(Dispatchers.IO) {
        val rt = tokenStore.refreshToken ?: return@withContext false
        val body = json.encodeToString(RefreshRequest.serializer(), RefreshRequest(rt))
            .toRequestBody(JSON_MEDIA_TYPE)
        val req = Request.Builder().url(apiUrl("/auth/refresh")).post(body).build()
        runCatching {
            http.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext false
                val envelope = json.decodeFromString(AuthEnvelope.serializer(), resp.body!!.string())
                tokenStore.saveTokens(envelope.data.token, envelope.data.refresh_token)
                true
            }
        }.getOrDefault(false)
    }

    /** Returns the raw session JSON string (or null if nothing is active). */
    suspend fun getActiveSession(): String? = withContext(Dispatchers.IO) {
        val body = executeWithRefresh { authedRequest("/active-session").get().build() } ?: return@withContext null
        json.decodeFromString(ActiveSessionEnvelope.serializer(), body).data?.data
    }

    suspend fun putActiveSession(sessionJson: String): Boolean = withContext(Dispatchers.IO) {
        val body = json.encodeToString(PutActiveSessionRequest.serializer(), PutActiveSessionRequest(sessionJson))
            .toRequestBody(JSON_MEDIA_TYPE)
        executeWithRefresh { authedRequest("/active-session").put(body).build() } != null
    }

    suspend fun deleteActiveSession(): Boolean = withContext(Dispatchers.IO) {
        executeWithRefresh { authedRequest("/active-session").delete().build() } != null
    }

    /** Persists a finished (or early-ended) workout. See backend/controllers/workouts.go CreateWorkout. */
    suspend fun createWorkout(req: CreateWorkoutRequest): Boolean = withContext(Dispatchers.IO) {
        val body = json.encodeToString(CreateWorkoutRequest.serializer(), req).toRequestBody(JSON_MEDIA_TYPE)
        executeWithRefresh { authedRequest("/workouts").post(body).build() } != null
    }

    private fun authedRequest(path: String) = Request.Builder()
        .url(apiUrl(path))
        .header("Authorization", "Bearer ${tokenStore.accessToken}")

    /** Runs [buildRequest], retrying once after a token refresh if the access token expired. */
    private suspend fun executeWithRefresh(buildRequest: () -> Request): String? = runCatching {
        var resp = http.newCall(buildRequest()).execute()
        if (resp.code == 401) {
            resp.close()
            Log.d(TAG, "executeWithRefresh: 401, attempting token refresh")
            if (!refresh()) {
                Log.w(TAG, "executeWithRefresh: refresh failed")
                return null
            }
            resp = http.newCall(buildRequest()).execute()
        }
        resp.use {
            if (it.isSuccessful) {
                it.body?.string()
            } else {
                Log.w(TAG, "executeWithRefresh: HTTP ${it.code} for ${buildRequest().url}")
                null
            }
        }
    }.onFailure { Log.e(TAG, "executeWithRefresh: request failed", it) }.getOrNull()

    private companion object {
        val JSON_MEDIA_TYPE = "application/json".toMediaType()
    }
}
