package com.lyftr.phone.health

import android.content.Context
import android.util.Log
import androidx.activity.result.contract.ActivityResultContract
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.aggregate.AggregationResult
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.CyclingPedalingCadenceRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.FloorsClimbedRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsCadenceRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.Vo2MaxRecord
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
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
import java.time.LocalDateTime
import java.time.Period
import java.time.ZoneId
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
        HealthPermission.getReadPermission(StepsRecord::class),
        // Per-session average cadence (cycling RPM or running/walking steps/min)
        // for cardio sessions — read raw and averaged in aggregateTotals()
        // since neither record type exposes an AggregateMetric in
        // connect-client 1.1.0-alpha07 (verified against the resolved SDK jar).
        HealthPermission.getReadPermission(CyclingPedalingCadenceRecord::class),
        HealthPermission.getReadPermission(StepsCadenceRecord::class),
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
                avg_cadence = totals.avgCadence,
            )
        }
    }

    private const val TAG = "CardioSync"

    private data class SessionTotals(
        val distanceMeters: Double,
        val avgHeartRate: Int,
        val calories: Double,
        val avgCadence: Double?,
    )

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
            avgCadence = averageCadence(client, start, end),
        )
    }

    /**
     * Average cadence over a session window. Neither CyclingPedalingCadenceRecord
     * nor StepsCadenceRecord exposes an AggregateMetric in connect-client
     * 1.1.0-alpha07 (verified against the resolved SDK jar — only
     * SpeedRecord/PowerRecord have AVG/MAX/MIN companions), so this reads the
     * raw per-sample records for the window and averages them in Kotlin
     * instead. A session can be cycling (pedaling RPM) or running/walking
     * (steps cadence) — whichever type actually has samples in this window
     * wins; cycling is checked first since it's unambiguous when present.
     */
    private suspend fun averageCadence(client: HealthConnectClient, start: Instant, end: Instant): Double? {
        val range = TimeRangeFilter.between(start, end)
        val cyclingSamples = client.readRecords(
            ReadRecordsRequest(recordType = CyclingPedalingCadenceRecord::class, timeRangeFilter = range),
        ).records.flatMap { it.samples }
        if (cyclingSamples.isNotEmpty()) {
            return cyclingSamples.map { it.revolutionsPerMinute }.average()
        }
        val stepsSamples = client.readRecords(
            ReadRecordsRequest(recordType = StepsCadenceRecord::class, timeRangeFilter = range),
        ).records.flatMap { it.samples }
        if (stepsSamples.isNotEmpty()) {
            return stepsSamples.map { it.rate }.average()
        }
        return null
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
     * Raw beats-per-minute samples in (since, now], delivered one Health
     * Connect page at a time via [onBatch] rather than collected into one
     * list. `since` null means "every sample Health Connect has" — the
     * one-time full-history backfill on a device's first sync, which can
     * mean years of continuous watch data; accumulating that across every
     * page before returning is what caused an OutOfMemoryError in practice
     * (each HeartRateRecord page holds many samples, and pages kept
     * appending to one growing list for the whole history). Streaming a
     * page — converted, uploaded, and discarded — through [onBatch] keeps
     * peak memory bounded to one page regardless of history length.
     */
    suspend fun readHeartRateSamples(
        client: HealthConnectClient,
        since: Instant?,
        // Returns whether to keep reading further pages — false stops early
        // (e.g. once an upload batch fails) instead of burning through the
        // rest of a potentially years-long history for no reason.
        onBatch: suspend (samples: List<HeartRateSampleDto>, latest: Instant) -> Boolean,
    ) {
        val range = TimeRangeFilter.after(since ?: Instant.EPOCH)
        var token: String? = null
        do {
            // Smaller than the 1000-record default: each HeartRateRecord can
            // itself hold a burst of many samples, so 1000 records/page can
            // still mean far more than 1000 samples held at once — the
            // OutOfMemoryError this streaming rewrite fixed came from
            // buffering across pages, but a defensively smaller page size
            // keeps peak memory for a single page low too.
            val page = client.readRecords(
                ReadRecordsRequest(recordType = HeartRateRecord::class, timeRangeFilter = range, pageToken = token, pageSize = 200),
            )
            var latest: Instant? = null
            val batch = page.records.flatMap { record ->
                record.samples.map { sample ->
                    if (latest == null || sample.time.isAfter(latest)) latest = sample.time
                    HeartRateSampleDto(
                        external_id = "${record.metadata.id}:${sample.time.epochSecond}",
                        recorded_at = ISO_FORMAT.format(sample.time),
                        bpm = sample.beatsPerMinute.toInt(),
                    )
                }
            }
            if (batch.isNotEmpty() && !onBatch(batch, latest!!)) return
            token = page.pageToken
        } while (token != null)
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

        // Deliberately NOT summing raw StepsRecord.count like the other metric
        // types above: a phone's built-in pedometer, a watch companion app,
        // Google Fit, etc. can each write their own overlapping StepsRecords
        // for the same physical steps, and naively summing every record
        // roughly doubled real daily totals in practice. Restricted to
        // STEPS_DATA_ORIGIN (the Pixel Watch) rather than trusting Health
        // Connect's own cross-source priority/dedup — see readStepsAggregate.
        val steps = readStepsAggregate(client, since)

        return hrv + spo2 + restingHr + activeCalories + vo2Max + floors + steps
    }

    /**
     * The Pixel Watch (via the Fitbit/Google Health app) is treated as the
     * sole system of record for steps — Health Connect's own cross-source
     * priority/dedup logic didn't reliably match the watch's own numbers in
     * practice, so instead of trusting it, every other contributing source
     * (e.g. the phone's own step counter) is excluded outright via
     * `dataOriginFilter`.
     */
    private val STEPS_DATA_ORIGIN = DataOrigin("com.fitbit.FitbitMobile")

    /**
     * Daily step totals in (since, now], via Health Connect's per-day
     * aggregate restricted to [STEPS_DATA_ORIGIN] rather than summing raw
     * StepsRecord entries — see the call site in [readHealthMetrics].
     * Windowed into ~1-year chunks: a `since = null` full-history backfill
     * spans decades back to [Instant.EPOCH], and one
     * [HealthConnectClient.aggregateGroupByPeriod] call for a multi-decade
     * range with a daily slicer was observed to fail outright (surfacing as
     * a generic "couldn't read Health Connect" sync error) rather than just
     * being slow — chunking keeps each call's bucket count small regardless
     * of how far back the backfill goes.
     */
    private suspend fun readStepsAggregate(client: HealthConnectClient, since: Instant?): List<HealthMetricDto> {
        val zone = ZoneId.systemDefault()
        var windowStart = LocalDateTime.ofInstant(since ?: Instant.EPOCH, zone)
        val end = LocalDateTime.ofInstant(Instant.now(), zone)
        val out = mutableListOf<HealthMetricDto>()
        while (windowStart.isBefore(end)) {
            val windowEnd = minOf(windowStart.plusYears(1), end)
            val buckets = client.aggregateGroupByPeriod(
                AggregateGroupByPeriodRequest(
                    metrics = setOf(StepsRecord.COUNT_TOTAL),
                    timeRangeFilter = TimeRangeFilter.between(windowStart, windowEnd),
                    timeRangeSlicer = Period.ofDays(1),
                    dataOriginFilter = setOf(STEPS_DATA_ORIGIN),
                ),
            )
            for (bucket in buckets) {
                val total = bucket.result[StepsRecord.COUNT_TOTAL] ?: continue
                val dayEnd = bucket.endTime.atZone(zone).toInstant()
                out += toMetric("steps", "steps-daily-${bucket.startTime.toLocalDate()}", dayEnd, total.toDouble(), "steps")
            }
            windowStart = windowEnd
        }
        return out
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
