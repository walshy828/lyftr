package com.lyftr.phone.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.lyftr.phone.auth.LyftrApiClient
import com.lyftr.phone.auth.SyncLogEntry
import com.lyftr.phone.auth.TokenStore
import com.lyftr.phone.health.HealthConnectSync
import java.time.Instant
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow

/**
 * Pulls raw heart rate samples, scalar health metrics (HRV, SpO2, resting
 * heart rate, active calories, VO2 max, floors climbed), and sleep sessions
 * from Health Connect into Lyftr — the full-archive counterpart to
 * [CardioSyncWorker], which only handles cardio exercise sessions.
 *
 * Unlike CardioSyncWorker's fixed lookback + resubmit-everything approach
 * (fine for ~1 cardio session/day), each data type here is bounded by its own
 * persisted watermark in [TokenStore] ([TokenStore.lastHeartRateSyncAt] etc.)
 * — raw heart rate volume makes resubmitting the whole history every run too
 * expensive. A null watermark (never synced) reads Health Connect's entire
 * available history, which doubles as the one-time full-history backfill on
 * a device's first sync; every run after that only reads what's new.
 *
 * Structurally mirrors CardioSyncWorker: same status-enum/sync-log shape and
 * schedule/syncNow/observe* companion methods, registered under its own
 * unique WorkManager names so the two workers never race each other.
 */
class HealthMetricsSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    enum class Status { NOT_LOGGED_IN, HEALTH_CONNECT_UNAVAILABLE, PERMISSION_NOT_GRANTED, OK, IMPORT_FAILED, READ_FAILED }

    override suspend fun doWork(): Result {
        val tokenStore = TokenStore(applicationContext)

        fun record(status: Status, imported: Int = 0, updated: Int = 0, found: Int = 0, ok: Boolean = true): Result {
            tokenStore.appendHealthSyncLogEntry(
                SyncLogEntry(at = Instant.now().toEpochMilli(), status = status.name, imported = imported, updated = updated, found = found),
            )
            val data = workDataOf(STATUS to status.name, KEY_IMPORTED to imported, KEY_UPDATED to updated, KEY_FOUND to found)
            return if (ok) Result.success(data) else Result.failure(data)
        }

        if (!tokenStore.isLoggedIn) return record(Status.NOT_LOGGED_IN, ok = false)
        if (!HealthConnectSync.isAvailable(applicationContext)) {
            return record(Status.HEALTH_CONNECT_UNAVAILABLE, ok = false)
        }

        val client = HealthConnectSync.client(applicationContext)
        if (!HealthConnectSync.hasPermissions(client)) {
            return record(Status.PERMISSION_NOT_GRANTED, ok = false)
        }

        val api = LyftrApiClient(tokenStore)
        var totalImported = 0
        var totalUpdated = 0
        var totalFound = 0

        // Each data type reads+imports independently: a failure in one
        // (e.g. the import call) shouldn't block the others from making
        // progress, and each only advances its own watermark on success so a
        // partial failure re-reads just that type's gap next run.
        try {
            val heartRate = HealthConnectSync.readHeartRateSamples(client, tokenStore.lastHeartRateSyncAt)
            totalFound += heartRate.size
            if (heartRate.isNotEmpty()) {
                val result = api.importHeartRateSamples(heartRate) ?: return record(Status.IMPORT_FAILED, found = totalFound, ok = false)
                totalImported += result.imported
                totalUpdated += result.updated
            }
            tokenStore.lastHeartRateSyncAt = Instant.now()

            val metrics = HealthConnectSync.readHealthMetrics(client, tokenStore.lastHealthMetricsSyncAt)
            totalFound += metrics.size
            if (metrics.isNotEmpty()) {
                val result = api.importHealthMetrics(metrics) ?: return record(Status.IMPORT_FAILED, found = totalFound, ok = false)
                totalImported += result.imported
                totalUpdated += result.updated
            }
            tokenStore.lastHealthMetricsSyncAt = Instant.now()

            val sleep = HealthConnectSync.readSleepSessions(client, tokenStore.lastSleepSyncAt)
            totalFound += sleep.size
            if (sleep.isNotEmpty()) {
                val result = api.importSleepSessions(sleep) ?: return record(Status.IMPORT_FAILED, found = totalFound, ok = false)
                totalImported += result.imported
                totalUpdated += result.updated
            }
            tokenStore.lastSleepSyncAt = Instant.now()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            return record(Status.READ_FAILED, ok = false)
        }

        return record(Status.OK, imported = totalImported, updated = totalUpdated, found = totalFound)
    }

    companion object {
        private const val PERIODIC_WORK_NAME = "lyftr_health_metrics_sync"
        const val MANUAL_WORK_NAME = "lyftr_health_metrics_sync_manual"

        const val STATUS = "status"
        const val KEY_IMPORTED = "imported"
        const val KEY_UPDATED = "updated"
        const val KEY_FOUND = "found"

        /** Same 24h/2h-flex cadence as CardioSyncWorker.schedule — see its doc for the rationale. */
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<HealthMetricsSyncWorker>(24, TimeUnit.HOURS, 2, TimeUnit.HOURS)
                .setConstraints(Constraints(requiredNetworkType = NetworkType.CONNECTED))
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(PERIODIC_WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_WORK_NAME)
        }

        fun syncNow(context: Context, expedited: Boolean = false) {
            var builder = OneTimeWorkRequestBuilder<HealthMetricsSyncWorker>()
                .setConstraints(Constraints(requiredNetworkType = NetworkType.CONNECTED))
            if (expedited) {
                builder = builder.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            }
            WorkManager.getInstance(context)
                .enqueueUniqueWork(MANUAL_WORK_NAME, ExistingWorkPolicy.REPLACE, builder.build())
        }

        fun observeManualSync(context: Context): Flow<List<WorkInfo>> =
            WorkManager.getInstance(context).getWorkInfosForUniqueWorkFlow(MANUAL_WORK_NAME)

        fun observePeriodicSync(context: Context): Flow<List<WorkInfo>> =
            WorkManager.getInstance(context).getWorkInfosForUniqueWorkFlow(PERIODIC_WORK_NAME)
    }
}

fun Data.healthStatusOrNull(): HealthMetricsSyncWorker.Status? =
    getString(HealthMetricsSyncWorker.STATUS)?.let { runCatching { HealthMetricsSyncWorker.Status.valueOf(it) }.getOrNull() }
