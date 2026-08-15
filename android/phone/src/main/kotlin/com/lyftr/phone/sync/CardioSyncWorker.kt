package com.lyftr.phone.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.lyftr.phone.auth.LyftrApiClient
import com.lyftr.phone.auth.TokenStore
import com.lyftr.phone.health.HealthConnectSync
import java.time.Instant
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.Flow

/**
 * Pulls cardio sessions (runs/rides/walks) the Pixel Watch already recorded
 * into Health Connect and imports any new ones into Lyftr. Mirrors
 * [com.lyftr.phone.auth.TokenRefreshWorker]'s shape: a small periodic
 * WorkManager job, plus [syncNow] for the manual "Sync cardio now" button on
 * StatusScreen, both funneling through the same unique work name so they
 * never race each other.
 *
 * TokenStore.lastCardioSyncAt is display-only ("Last synced: ..." on
 * StatusScreen) — it does NOT gate which sessions get read. Every run
 * re-scans HealthConnectSync.LOOKBACK and resubmits the whole batch; the
 * backend's external_id dedup (backend/stores/cardio.go Import) makes that
 * safe and cheap. An earlier version filtered by a persisted watermark
 * advanced to "when the sync ran" rather than the session's own time, which
 * could permanently skip a session that reached Health Connect a little late
 * — don't reintroduce that.
 *
 * [Result.success]/[Result.failure] carry a [STATUS] in their output data so
 * StatusScreen can show what actually happened rather than a "did it run?"
 * guess — see [Status].
 */
class CardioSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    /** Machine-readable outcome, stashed in Result output data as [STATUS]. */
    enum class Status { NOT_LOGGED_IN, HEALTH_CONNECT_UNAVAILABLE, PERMISSION_NOT_GRANTED, OK, IMPORT_FAILED }

    override suspend fun doWork(): Result {
        val tokenStore = TokenStore(applicationContext)
        if (!tokenStore.isLoggedIn) return Result.success(statusData(Status.NOT_LOGGED_IN))
        if (!HealthConnectSync.isAvailable(applicationContext)) {
            return Result.success(statusData(Status.HEALTH_CONNECT_UNAVAILABLE))
        }

        val client = HealthConnectSync.client(applicationContext)
        if (!HealthConnectSync.hasPermissions(client)) {
            return Result.success(statusData(Status.PERMISSION_NOT_GRANTED))
        }

        val runStartedAt = Instant.now()
        val sessions = HealthConnectSync.readRecentCardioSessions(client)
        if (sessions.isEmpty()) {
            tokenStore.lastCardioSyncAt = runStartedAt
            return Result.success(statusData(Status.OK, imported = 0, found = 0, syncedAt = runStartedAt))
        }

        val imported = LyftrApiClient(tokenStore).importCardioSessions(sessions)
            ?: return Result.failure(statusData(Status.IMPORT_FAILED))

        tokenStore.lastCardioSyncAt = runStartedAt
        return Result.success(statusData(Status.OK, imported = imported, found = sessions.size, syncedAt = runStartedAt))
    }

    private fun statusData(status: Status, imported: Int = 0, found: Int = 0, syncedAt: Instant? = null) =
        workDataOf(
            STATUS to status.name,
            KEY_IMPORTED to imported,
            KEY_FOUND to found,
            KEY_SYNCED_AT to (syncedAt?.toEpochMilli() ?: -1L),
        )

    companion object {
        private const val PERIODIC_WORK_NAME = "lyftr_cardio_sync"
        const val MANUAL_WORK_NAME = "lyftr_cardio_sync_manual"

        const val STATUS = "status"
        const val KEY_IMPORTED = "imported"
        const val KEY_FOUND = "found"
        const val KEY_SYNCED_AT = "synced_at"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<CardioSyncWorker>(6, TimeUnit.HOURS)
                .setConstraints(Constraints(requiredNetworkType = NetworkType.CONNECTED))
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(PERIODIC_WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_WORK_NAME)
        }

        /**
         * Triggered by the "Sync cardio now" button. REPLACE (not KEEP) is
         * required here — KEEP treats any past work under this unique name,
         * including ones that already finished, as "still there" and silently
         * no-ops every tap after the first. REPLACE always starts a fresh run.
         */
        fun syncNow(context: Context) {
            val request = OneTimeWorkRequestBuilder<CardioSyncWorker>()
                .setConstraints(Constraints(requiredNetworkType = NetworkType.CONNECTED))
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(MANUAL_WORK_NAME, ExistingWorkPolicy.REPLACE, request)
        }

        /** StatusScreen observes this to show live sync status + the result of the last run. */
        fun observeManualSync(context: Context): Flow<List<WorkInfo>> =
            WorkManager.getInstance(context).getWorkInfosForUniqueWorkFlow(MANUAL_WORK_NAME)
    }
}

/** Data.getInt has no nullable form; -1 doubles as "field absent". */
fun Data.statusOrNull(): CardioSyncWorker.Status? =
    getString(CardioSyncWorker.STATUS)?.let { runCatching { CardioSyncWorker.Status.valueOf(it) }.getOrNull() }
