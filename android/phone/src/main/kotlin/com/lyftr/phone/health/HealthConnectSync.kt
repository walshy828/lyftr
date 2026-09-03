package com.lyftr.phone.health

import android.content.Context
import android.util.Log
import androidx.activity.result.contract.ActivityResultContract
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.aggregate.AggregationResult
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.FloorsClimbedRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.Vo2MaxRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.lyftr.phone.auth.CardioSessionDto
import com.lyftr.phone.auth.HealthMetricDto
import com.lyftr.phone.auth.HeartRateSampleDto
import com.lyftr.phone.auth.SleepSessionDto
import com.lyftr.phone.auth.SleepStageDto
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
     * to summarize a session, never as raw streams (no HR time-series in v1).
     *
     * PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND is required or every
     * CardioSyncWorker periodic run's client.aggregate() call throws
     * SecurityException ("must be in foreground") the moment the worker
     * executes outside the app's foreground — i.e. every scheduled run.
     * Without it, cardio import only ever works while the app happens to be
     * open (manual sync / on-open catch-up), which looks like intermittent
     * missing sessions rather than the systemic gap it actually is. */
    val PERMISSIONS = setOf(
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
        HealthPermission.getReadPermission(DistanceRecord::class),
        HealthPermission.getReadPermission(HeartRateRecord::class),
        HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class),
        // Added for the full health-data archive (raw HR samples + scalar
        // metrics + sleep), on top of the cardio-session summary fields above.
        HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class),
        HealthPermission.getReadPermission(OxygenSaturationRecord::class),
        HealthPermission.getReadPermission(RestingHeartRateRecord::class),
        HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
        HealthPermission.getReadPermission(Vo2MaxRecord::class),
        HealthPermission.getReadPermission(FloorsClimbedRecord::class),
        HealthPermission.getReadPermission(SleepSessionRecord::class),
        HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND,
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

    /**
     * Health Connect pages large result sets (~1000-5000 records/page
     * depending on record type); each read function below follows the
     * pageToken until it's null so a full-history first sync (since = null)
     * doesn't silently truncate at one page.
     */
    private suspend fun <T> readAllPages(
        client: HealthConnectClient,
        page: suspend (pageToken: String?) -> Pair<List<T>, String?>,
    ): List<T> {
        val out = mutableListOf<T>()
        var token: String? = null
        do {
            val (records, next) = page(token)
            out += records
            token = next
        } while (token != null)
        return out
    }

    /**
     * Raw beats-per-minute samples in (since, now]. `since` null means "every
     * sample Health Connect has" — the one-time full-history backfill on a
     * device's first sync; every run after that passes the sync watermark
     * (see HealthMetricsSyncWorker), never the full history again, since raw
     * HR volume makes re-scanning everything on every run too expensive.
     */
    suspend fun readHeartRateSamples(client: HealthConnectClient, since: Instant?): List<HeartRateSampleDto> {
        val range = TimeRangeFilter.after(since ?: Instant.EPOCH)
        val records = readAllPages(client) { token ->
            val page = client.readRecords(
                ReadRecordsRequest(recordType = HeartRateRecord::class, timeRangeFilter = range, pageToken = token),
            )
            page.records to page.pageToken
        }
        return records.flatMap { record ->
            record.samples.map { sample ->
                HeartRateSampleDto(
                    external_id = "${record.metadata.id}:${sample.time.epochSecond}",
                    recorded_at = ISO_FORMAT.format(sample.time),
                    bpm = sample.beatsPerMinute.toInt(),
                )
            }
        }
    }

    /**
     * Scalar health metrics (HRV RMSSD, SpO2, resting heart rate, active
     * calories, VO2 max, floors climbed) in (since, now]. See
     * [readHeartRateSamples] for the since=null full-history meaning.
     */
    suspend fun readHealthMetrics(client: HealthConnectClient, since: Instant?): List<HealthMetricDto> {
        val range = TimeRangeFilter.after(since ?: Instant.EPOCH)

        val hrv = readAllPages(client) { token ->
            val page = client.readRecords(
                ReadRecordsRequest(recordType = HeartRateVariabilityRmssdRecord::class, timeRangeFilter = range, pageToken = token),
            )
            page.records to page.pageToken
        }.map { toMetric("hrv_rmssd", it.metadata.id, it.time, it.heartRateVariabilityMillis, "ms") }

        val spo2 = readAllPages(client) { token ->
            val page = client.readRecords(
                ReadRecordsRequest(recordType = OxygenSaturationRecord::class, timeRangeFilter = range, pageToken = token),
            )
            page.records to page.pageToken
        }.map { toMetric("spo2", it.metadata.id, it.time, it.percentage.value, "%") }

        val restingHr = readAllPages(client) { token ->
            val page = client.readRecords(
                ReadRecordsRequest(recordType = RestingHeartRateRecord::class, timeRangeFilter = range, pageToken = token),
            )
            page.records to page.pageToken
        }.map { toMetric("resting_heart_rate", it.metadata.id, it.time, it.beatsPerMinute.toDouble(), "bpm") }

        val activeCalories = readAllPages(client) { token ->
            val page = client.readRecords(
                ReadRecordsRequest(recordType = ActiveCaloriesBurnedRecord::class, timeRangeFilter = range, pageToken = token),
            )
            page.records to page.pageToken
        }.map { toMetric("active_calories", it.metadata.id, it.endTime, it.energy.inKilocalories, "kcal") }

        val vo2Max = readAllPages(client) { token ->
            val page = client.readRecords(
                ReadRecordsRequest(recordType = Vo2MaxRecord::class, timeRangeFilter = range, pageToken = token),
            )
            page.records to page.pageToken
        }.map { toMetric("vo2_max", it.metadata.id, it.time, it.vo2MillilitersPerMinuteKilogram, "ml/kg/min") }

        val floors = readAllPages(client) { token ->
            val page = client.readRecords(
                ReadRecordsRequest(recordType = FloorsClimbedRecord::class, timeRangeFilter = range, pageToken = token),
            )
            page.records to page.pageToken
        }.map { toMetric("floors_climbed", it.metadata.id, it.endTime, it.floors, "floors") }

        return hrv + spo2 + restingHr + activeCalories + vo2Max + floors
    }

    private fun toMetric(metricType: String, externalId: String, at: Instant, value: Double, unit: String) =
        HealthMetricDto(
            metric_type = metricType,
            external_id = externalId,
            recorded_at = ISO_FORMAT.format(at),
            value = value,
            unit = unit,
        )

    /**
     * Sleep sessions (with their nested stage breakdown) in (since, now).
     * Health Connect exposes stages as a list on SleepSessionRecord itself,
     * so no separate stage-record read is needed.
     */
    suspend fun readSleepSessions(client: HealthConnectClient, since: Instant?): List<SleepSessionDto> {
        val range = TimeRangeFilter.after(since ?: Instant.EPOCH)
        val records = readAllPages(client) { token ->
            val page = client.readRecords(
                ReadRecordsRequest(recordType = SleepSessionRecord::class, timeRangeFilter = range, pageToken = token),
            )
            page.records to page.pageToken
        }
        return records.map { session ->
            SleepSessionDto(
                external_id = session.metadata.id,
                started_at = ISO_FORMAT.format(session.startTime),
                ended_at = ISO_FORMAT.format(session.endTime),
                stages = session.stages.map { stage ->
                    SleepStageDto(
                        stage_type = sleepStageTypeOf(stage.stage),
                        started_at = ISO_FORMAT.format(stage.startTime),
                        ended_at = ISO_FORMAT.format(stage.endTime),
                    )
                },
            )
        }
    }

    /** Collapses Health Connect's finer stage constants to Lyftr's 4-value stage_type. */
    private fun sleepStageTypeOf(stage: Int): String = when (stage) {
        SleepSessionRecord.STAGE_TYPE_DEEP -> "deep"
        SleepSessionRecord.STAGE_TYPE_REM -> "rem"
        SleepSessionRecord.STAGE_TYPE_LIGHT -> "light"
        SleepSessionRecord.STAGE_TYPE_AWAKE,
        SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED,
        SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> "awake"
        else -> "awake" // STAGE_TYPE_UNKNOWN and any future constant
    }
}
