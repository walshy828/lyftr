package com.lyftr.phone.auth

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

private const val TAG = "LyftrSync"

@Serializable private data class LoginRequest(val email: String, val password: String, val remember: Boolean = true)
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
 * Mirrors backend/models/models.go's CreateCardioSessionRequest. external_id
 * is the Health Connect record's own UUID — the backend dedupes imports on
 * (user_id, external_id), so CardioSyncWorker can resubmit its whole batch
 * every run with no local bookkeeping of what already made it across.
 */
@Serializable
data class CardioSessionDto(
    val external_id: String,
    val activity_type: String,
    val title: String = "",
    val started_at: String,
    val ended_at: String,
    val duration_seconds: Int,
    val distance_meters: Double = 0.0,
    val avg_heart_rate: Int = 0,
    val calories: Double = 0.0,
    val avg_cadence: Double? = null,
)

@Serializable
private data class ImportCardioSessionsRequest(val sessions: List<CardioSessionDto>)
@Serializable
private data class ImportCardioSessionsResult(val imported: Int, val updated: Int = 0, val submitted: Int)
@Serializable
private data class ImportCardioSessionsEnvelope(val data: ImportCardioSessionsResult)

/** Result of a login/refresh attempt; see [LyftrApiClient.refresh]. */
enum class AuthOutcome { OK, REJECTED, TRANSIENT }

/** Outcome of a cardio import batch: rows newly inserted vs existing rows overwritten. */
data class CardioImportResult(val imported: Int, val updated: Int)

/** Mirrors backend/models/models.go's CreateHeartRateSampleRequest. */
@Serializable
data class HeartRateSampleDto(
    val external_id: String,
    val recorded_at: String,
    val bpm: Int,
)

/**
 * Mirrors backend/models/models.go's CreateHealthMetricRequest. metric_type
 * is one of the models.MetricType* constants (hrv_rmssd, spo2,
 * resting_heart_rate, active_calories, vo2_max, floors_climbed).
 */
@Serializable
data class HealthMetricDto(
    val metric_type: String,
    val external_id: String,
    val recorded_at: String,
    val value: Double,
    val unit: String = "",
)

/** Mirrors backend/models/models.go's CreateSleepStageRequest. */
@Serializable
data class SleepStageDto(
    val stage_type: String,
    val started_at: String,
    val ended_at: String,
)

/** Mirrors backend/models/models.go's CreateSleepSessionRequest. */
@Serializable
data class SleepSessionDto(
    val external_id: String,
    val started_at: String,
    val ended_at: String,
    val stages: List<SleepStageDto> = emptyList(),
)

@Serializable
private data class ImportHeartRateSamplesRequest(val samples: List<HeartRateSampleDto>)
@Serializable
private data class ImportHealthMetricsRequest(val metrics: List<HealthMetricDto>)
@Serializable
private data class ImportSleepSessionsRequest(val sessions: List<SleepSessionDto>)

@Serializable
private data class ImportResultData(val imported: Int, val updated: Int = 0, val submitted: Int)
@Serializable
private data class ImportResultEnvelope(val data: ImportResultData)

/** Outcome of any of the health-data import batches above. */
data class HealthImportResult(val imported: Int, val updated: Int)

/**
 * Minimal REST client for the subset of the Lyftr API (backend/routes/routes.go)
 * the phone companion needs: login/refresh and the active-session blob sync
 * (backend/controllers/active_session.go). No offline queueing — per the
 * companion's scope, a lost connection just means the next poll/PUT retries.
 */
class LyftrApiClient(private val tokenStore: TokenStore) {
    // Default 10s connect/read/write timeouts are too tight for a health-data
    // import batch — a full Health Connect history backfill (e.g. years of
    // steps records on a first sync) can take longer than that to serialize,
    // upload, and insert server-side, and a timeout there was surfacing as a
    // generic "check your connection" failure with a fine connection.
    private val http = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()
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

    /**
     * `remember: true` is always sent (backend/controllers/auth.go startSession)
     * — there's no "keep me signed in" checkbox here because the companion app
     * IS the remembered device: it runs unattended in the background doing
     * auto-sync (see TokenRefreshWorker), so it needs the long-lived
     * REMEMBER_TTL-backed refresh token (default 30 days, sliding on every
     * refresh) rather than the 12h default meant for an interactive browser
     * session. Without this, the refresh token dies well before
     * TokenRefreshWorker's daily rotation ever runs, which is exactly what was
     * causing the app to silently log itself out and stop auto-syncing.
     */
    suspend fun login(email: String, password: String): Boolean =
        loginOutcome(email, password) == AuthOutcome.OK

    /**
     * Same as [login] but distinguishes "server said no" ([AuthOutcome.REJECTED])
     * from "couldn't reach it / it hiccuped" ([AuthOutcome.TRANSIENT]) — callers
     * running unattended must not treat the latter as a dead session.
     */
    private suspend fun loginOutcome(email: String, password: String): AuthOutcome = withContext(Dispatchers.IO) {
        val body = json.encodeToString(LoginRequest.serializer(), LoginRequest(email, password, remember = true))
            .toRequestBody(JSON_MEDIA_TYPE)
        val req = Request.Builder().url(apiUrl("/auth/login")).post(body).build()
        runCatching {
            http.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext classify(resp.code)
                val envelope = json.decodeFromString(AuthEnvelope.serializer(), resp.body!!.string())
                tokenStore.saveTokens(envelope.data.token, envelope.data.refresh_token)
                tokenStore.clearSessionExpired()
                AuthOutcome.OK
            }
        }.getOrDefault(AuthOutcome.TRANSIENT)
    }

    /**
     * Rotates the token pair using the stored refresh token. See
     * backend/utils/jwt.go — the backend treats a refresh token as single-use
     * and revokes it the moment it's redeemed, so two callers racing to
     * refresh the same stored token is not a harmless duplicate request: the
     * loser presents a token the winner already spent, the backend correctly
     * rejects it, and (pre-fix) that rejection was indistinguishable from a
     * genuinely dead session — [LyftrApiClient.executeWithRefresh] would wipe
     * the winner's freshly-saved, perfectly valid tokens via
     * [TokenStore.expireSession] and bounce the user to a login prompt.
     *
     * This app has three independent ~24h periodic workers (CardioSyncWorker,
     * HealthMetricsSyncWorker, TokenRefreshWorker) that can land in the same
     * flex window and each hit an expired access token at once, so the race
     * was routine rather than rare — this is the "logs out every day" bug.
     * [refreshMutex] serializes redemption process-wide (it's a companion
     * object, so every LyftrApiClient instance in the process shares it): a
     * caller that loses the race blocks until the winner's write lands, then
     * re-reads [TokenStore.refreshToken] and finds it already rotated, so it
     * never presents a stale token at all.
     */
    suspend fun refresh(): AuthOutcome = refreshMutex.withLock {
        withContext(Dispatchers.IO) {
            val rt = tokenStore.refreshToken
            val outcome = if (rt == null) {
                Log.w(TAG, "refresh: no refresh token stored")
                AuthOutcome.REJECTED
            } else {
                val body = json.encodeToString(RefreshRequest.serializer(), RefreshRequest(rt))
                    .toRequestBody(JSON_MEDIA_TYPE)
                val req = Request.Builder().url(apiUrl("/auth/refresh")).post(body).build()
                runCatching {
                    http.newCall(req).execute().use { resp ->
                        if (!resp.isSuccessful) {
                            Log.w(TAG, "refresh: HTTP ${resp.code} from ${req.url}: ${resp.body?.string()}")
                            return@use classify(resp.code)
                        }
                        val envelope = json.decodeFromString(AuthEnvelope.serializer(), resp.body!!.string())
                        tokenStore.saveTokens(envelope.data.token, envelope.data.refresh_token)
                        tokenStore.clearSessionExpired()
                        AuthOutcome.OK
                    }
                }.onFailure { Log.e(TAG, "refresh: request to ${req.url} failed", it) }
                    .getOrDefault(AuthOutcome.TRANSIENT)
            }
            if (outcome != AuthOutcome.REJECTED) return@withContext outcome

            // The refresh chain is genuinely dead (absolute session cap, a spent
            // token whose rotated replacement never reached us, a revoked device
            // session...). This app is an unattended companion, so before
            // surfacing a login prompt, re-establish the session with the
            // credentials LoginScreen saved. Still inside the mutex, so
            // concurrent callers queue behind it and find the fresh tokens.
            val email = tokenStore.savedEmail
            val password = tokenStore.savedPassword
            if (email.isNullOrBlank() || password.isNullOrBlank()) return@withContext AuthOutcome.REJECTED
            Log.i(TAG, "refresh: rejected, re-logging in with saved credentials")
            loginOutcome(email, password)
        }
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

    /**
     * Imports cardio sessions read from Health Connect. Returns the counts
     * newly inserted vs updated (a session already imported is overwritten
     * with its resubmitted values, e.g. if the user recategorized it in
     * Health Connect — not re-inserted or skipped), or null on failure. See
     * backend/controllers/cardio.go ImportCardioSessions.
     */
    suspend fun importCardioSessions(sessions: List<CardioSessionDto>): CardioImportResult? = withContext(Dispatchers.IO) {
        if (sessions.isEmpty()) return@withContext CardioImportResult(0, 0)
        val body = json.encodeToString(
            ImportCardioSessionsRequest.serializer(),
            ImportCardioSessionsRequest(sessions),
        ).toRequestBody(JSON_MEDIA_TYPE)
        val respBody = executeWithRefresh { authedRequest("/cardio/import").post(body).build() }
            ?: return@withContext null
        runCatching {
            val result = json.decodeFromString(ImportCardioSessionsEnvelope.serializer(), respBody).data
            CardioImportResult(result.imported, result.updated)
        }.getOrNull()
    }

    /** Imports raw heart rate samples. See backend/controllers/heart_rate.go ImportHeartRateSamples. */
    suspend fun importHeartRateSamples(samples: List<HeartRateSampleDto>): HealthImportResult? =
        importBatch("/heart-rate/import", ImportHeartRateSamplesRequest.serializer(), ImportHeartRateSamplesRequest(samples), samples.isEmpty())

    /** Imports scalar health metrics (HRV, SpO2, resting HR, active calories, VO2 max, floors). See backend/controllers/health_metrics.go ImportHealthMetrics. */
    suspend fun importHealthMetrics(metrics: List<HealthMetricDto>): HealthImportResult? =
        importBatch("/health-metrics/import", ImportHealthMetricsRequest.serializer(), ImportHealthMetricsRequest(metrics), metrics.isEmpty())

    /** Imports sleep sessions with stage detail. See backend/controllers/sleep.go ImportSleepSessions. */
    suspend fun importSleepSessions(sessions: List<SleepSessionDto>): HealthImportResult? =
        importBatch("/sleep/import", ImportSleepSessionsRequest.serializer(), ImportSleepSessionsRequest(sessions), sessions.isEmpty())

    private suspend fun <T> importBatch(
        path: String,
        serializer: kotlinx.serialization.KSerializer<T>,
        request: T,
        empty: Boolean,
    ): HealthImportResult? = withContext(Dispatchers.IO) {
        if (empty) return@withContext HealthImportResult(0, 0)
        val body = json.encodeToString(serializer, request).toRequestBody(JSON_MEDIA_TYPE)
        val respBody = executeWithRefresh { authedRequest(path).post(body).build() } ?: return@withContext null
        runCatching {
            val result = json.decodeFromString(ImportResultEnvelope.serializer(), respBody).data
            HealthImportResult(result.imported, result.updated)
        }.getOrNull()
    }

    private fun authedRequest(path: String) = Request.Builder()
        .url(apiUrl(path))
        .header("Authorization", "Bearer ${tokenStore.accessToken}")

    /**
     * Runs [buildRequest], retrying once after a token refresh if the access
     * token expired. If the refresh token itself is also expired/revoked,
     * marks the session expired ([TokenStore.expireSession]) so the UI
     * (LyftrPhoneApp) bounces back to a re-login prompt instead of silently
     * leaving StatusScreen showing stale/broken sync state.
     */
    private suspend fun executeWithRefresh(buildRequest: () -> Request): String? = runCatching {
        var resp = http.newCall(buildRequest()).execute()
        if (resp.code == 401) {
            resp.close()
            Log.d(TAG, "executeWithRefresh: 401, attempting token refresh")
            when (refresh()) {
                AuthOutcome.OK -> Unit
                AuthOutcome.TRANSIENT -> {
                    // Network blip / server restart: keep the tokens, let the
                    // next run retry. Wiping them here is what made a single
                    // bad night on the network force a manual re-login.
                    Log.w(TAG, "executeWithRefresh: refresh unreachable, will retry later")
                    return null
                }
                AuthOutcome.REJECTED -> {
                    Log.w(TAG, "executeWithRefresh: refresh rejected, marking session expired")
                    tokenStore.expireSession()
                    return null
                }
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

    /** 4xx (other than timeout/rate-limit) is the server refusing the credential; anything else is retryable. */
    private fun classify(code: Int) =
        if (code in 400..499 && code != 408 && code != 429) AuthOutcome.REJECTED else AuthOutcome.TRANSIENT

    private companion object {
        val JSON_MEDIA_TYPE = "application/json".toMediaType()

        // Process-wide: shared by every LyftrApiClient instance (each of the
        // three periodic workers builds its own), so it serializes refresh()
        // across them. See the kdoc on refresh() for why that matters.
        val refreshMutex = Mutex()
    }
}
