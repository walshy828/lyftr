package com.lyftr.phone.health

import android.content.Context
import android.util.Log
import androidx.activity.result.contract.ActivityResultContract
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.aggregate.AggregationResult
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.lyftr.phone.auth.CardioSessionDto
import java.time.Duration
import java.time.Instant
import java.time.format.DateTimeFormatter

/**
 * Read-only Health Connect access for cardio sessions the Pixel Watch already
 * recorded. Health Connect is entirely on-device (no Google account/OAuth
 * involved) — access is a local runtime permission grant, requested via
 * [permissionRequestContract] the same way notification permission would be.
 */
object HealthConnectSync {
    /** Cardio-relevant read scopes. Distance/heart rate/calories are read only
     * to summarize a session, never as raw streams (no HR time-series in v1). */
    val PERMISSIONS = setOf(
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
        HealthPermission.getReadPermission(DistanceRecord::class),
        HealthPermission.getReadPermission(HeartRateRecord::class),
        HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class),
    )

    /** False on a device where the Health Connect app/API isn't installed at all. */
    fun isAvailable(context: Context): Boolean =
        HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE

    fun client(context: Context): HealthConnectClient = HealthConnectClient.getOrCreate(context)

    suspend fun hasPermissions(client: HealthConnectClient): Boolean =
        client.permissionController.getGrantedPermissions().containsAll(PERMISSIONS)

    /** Compose/Activity contract for requesting [PERMISSIONS] via the system Health Connect UI. */
    fun permissionRequestContract(): ActivityResultContract<Set<String>, Set<String>> =
        PermissionController.createRequestPermissionResultContract()

    /**
     * How far back to look on every sync. Deliberately NOT a persisted
     * "last synced" watermark: advancing a watermark to "the time the sync
     * ran" (rather than the session's own time) can permanently skip a
     * session that reaches Health Connect a little late — e.g. the watch
     * hadn't finished syncing to the phone yet when a job happened to run.
     * The backend already dedupes imports on external_id (see
     * backend/stores/cardio.go Import), so re-scanning the same window every
     * time and resubmitting is both correct and cheap — no local bookkeeping
     * needed, matching what the backend was designed for.
     */
    private val LOOKBACK = Duration.ofDays(90)

    /**
     * Reads every cardio-type exercise session from the last [LOOKBACK]
     * period, with distance/avg-HR/calories aggregated per session.
     * Session-type filtering (cardio vs. strength/other) happens here so the
     * backend never sees a non-cardio Health Connect record.
     */
    suspend fun readRecentCardioSessions(client: HealthConnectClient): List<CardioSessionDto> {
        val sessions = client.readRecords(
            ReadRecordsRequest(
                recordType = ExerciseSessionRecord::class,
                timeRangeFilter = TimeRangeFilter.after(Instant.now().minus(LOOKBACK)),
            ),
        ).records

        // TEMPORARY diagnostic logging — remove once cardio sync is confirmed
        // working end-to-end. Prints exactly what Health Connect handed back
        // before any cardio-type filtering, so a "0 sessions" result can be
        // told apart from "found sessions, but none matched a cardio type".
        Log.d(TAG, "readRecentCardioSessions: Health Connect returned ${sessions.size} raw exercise record(s)")
        sessions.forEach { s ->
            Log.d(
                TAG,
                "  record id=${s.metadata.id} exerciseType=${s.exerciseType} " +
                    "title=${s.title} start=${s.startTime} end=${s.endTime} " +
                    "dataOrigin=${s.metadata.dataOrigin.packageName}",
            )
        }

        return sessions.mapNotNull { session ->
            val activityType = cardioActivityTypeOf(session.exerciseType)
            if (activityType == null) {
                Log.d(TAG, "  skipping id=${session.metadata.id}: exerciseType=${session.exerciseType} not in cardio map")
                return@mapNotNull null
            }
            val totals = aggregateTotals(client, session.startTime, session.endTime)
            CardioSessionDto(
                external_id = session.metadata.id,
                activity_type = activityType,
                title = session.title ?: "",
                started_at = ISO_FORMAT.format(session.startTime),
                ended_at = ISO_FORMAT.format(session.endTime),
                duration_seconds = (session.endTime.epochSecond - session.startTime.epochSecond).toInt(),
                distance_meters = totals.distanceMeters,
                avg_heart_rate = totals.avgHeartRate,
                calories = totals.calories,
            )
        }
    }

    private const val TAG = "CardioSync"

    private data class SessionTotals(val distanceMeters: Double, val avgHeartRate: Int, val calories: Double)

    private suspend fun aggregateTotals(client: HealthConnectClient, start: Instant, end: Instant): SessionTotals {
        val result: AggregationResult = client.aggregate(
            AggregateRequest(
                metrics = setOf(
                    DistanceRecord.DISTANCE_TOTAL,
                    HeartRateRecord.BPM_AVG,
                    TotalCaloriesBurnedRecord.ENERGY_TOTAL,
                ),
                timeRangeFilter = TimeRangeFilter.between(start, end),
            ),
        )
        return SessionTotals(
            distanceMeters = result[DistanceRecord.DISTANCE_TOTAL]?.inMeters ?: 0.0,
            avgHeartRate = result[HeartRateRecord.BPM_AVG]?.toInt() ?: 0,
            calories = result[TotalCaloriesBurnedRecord.ENERGY_TOTAL]?.inKilocalories ?: 0.0,
        )
    }

    /**
     * Maps Health Connect's exercise-type constants to Lyftr's activity_type
     * strings, keeping only cardio types (v1 scope — strength sessions logged
     * on the watch already reach the backend via the normal workout flow).
     * Returns null for anything not in this set, so it's silently skipped.
     *
     * EXERCISE_TYPE_OTHER_WORKOUT (0) is deliberately included as "workout":
     * Fitbit-sourced sessions land here far more often than under a specific
     * type — in practice most of a Fitbit user's actual activity, including
     * ordinary runs, is tagged this way rather than EXERCISE_TYPE_RUNNING.
     * Excluding it silently drops most real sessions.
     */
    private fun cardioActivityTypeOf(exerciseType: Int): String? = when (exerciseType) {
        ExerciseSessionRecord.EXERCISE_TYPE_OTHER_WORKOUT -> "workout"
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING,
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL -> "running"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING,
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY -> "cycling"
        ExerciseSessionRecord.EXERCISE_TYPE_WALKING,
        ExerciseSessionRecord.EXERCISE_TYPE_HIKING -> "walking"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_OPEN_WATER,
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL -> "swimming"
        ExerciseSessionRecord.EXERCISE_TYPE_ELLIPTICAL -> "elliptical"
        ExerciseSessionRecord.EXERCISE_TYPE_ROWING,
        ExerciseSessionRecord.EXERCISE_TYPE_ROWING_MACHINE -> "rowing"
        ExerciseSessionRecord.EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING -> "hiit"
        ExerciseSessionRecord.EXERCISE_TYPE_STAIR_CLIMBING,
        ExerciseSessionRecord.EXERCISE_TYPE_STAIR_CLIMBING_MACHINE -> "stair_climbing"
        else -> null
    }

    private val ISO_FORMAT = DateTimeFormatter.ISO_INSTANT
}
