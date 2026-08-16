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
import com.lyftr.phone.auth.SyncLogEntry
import com.lyftr.phone.auth.TokenStore
import com.lyftr.phone.health.HealthConnectSync
import java.time.Instant
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.Flow

/**
 * Pulls cardio sessions (runs/rides/walks) the Pixel Watch already recorded
 * into Health Connect and imports any new ones into Lyftr. Mirrors
 * [com.lyftr.phone.auth.TokenRefreshWorker]'s shape: a small periodic
 * WorkManager job, plus [syncNow] for the manual "Sync cardio now" button (and
 * StatusScreen's automatic on-open catch-up when the last sync looks stale —
 * both funnel through the same unique work name so they never race each
 * other.
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
 * guess — see [Status]. Every outcome (not just successes) is also appended
 * to [TokenStore.syncLog] so the Sync history list on StatusScreen answers
 * "is this actually working" without the user having to guess.
 *
 * Periodic interval: Android's Doze/App Standby can defer periodic
 * WorkManager jobs well past their requested interval regardless of how
 * short it is — there's no supported way around that without a foreground
 * service (wrong tool here) or a battery-optimization exemption prompt
 * (bad practice for a non-exempt app category, and works against the whole
 * point of keeping this sync cheap). So the interval below is a *ceiling*,
 * not a guarantee; StatusScreen's on-open staleness check is what actually
 * catches up a sync that got deferred, at zero background cost since it only
 * runs while the user already has the app open.
 */
class CardioSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    /** Machine-readable outcome, stashed in Result output data as [STATUS] and in [TokenStore.syncLog]. */
    enum class Status { NOT_LOGGED_IN, HEALTH_CONNECT_UNAVAILABLE, PERMISSION_NOT_GRANTED, OK, IMPORT_FAILED }

    override suspend fun doWork(): Result {
        val tokenStore = TokenStore(applicationContext)

        fun record(status: Status, imported: Int = 0, updated: Int = 0, found: Int = 0, ok: Boolean = true): Result {
            val now = Instant.now()
            tokenStore.appendSyncLogEntry(
                SyncLogEntry(at = now.toEpochMilli(), status = status.name, imported = imported, updated = updated, found = found),
            )
            val data = statusData(status, imported, updated, found, syncedAt = now.takeIf { status == Status.OK })
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

        val sessions = HealthConnectSync.readRecentCardioSessions(client)
        if (sessions.isEmpty()) {
            tokenStore.lastCardioSyncAt = Instant.now()
            return record(Status.OK, imported = 0, found = 0)
        }

        val result = LyftrApiClient(tokenStore).importCardioSessions(sessions)
            ?: return record(Status.IMPORT_FAILED, found = sessions.size, ok = false)

        tokenStore.lastCardioSyncAt = Instant.now()
        return record(Status.OK, imported = result.imported, updated = result.updated, found = sessions.size)
    }

    private fun statusData(
        status: Status,
        imported: Int = 0,
        updated: Int = 0,
        found: Int = 0,
        syncedAt: Instant? = null,
    ) = workDataOf(
        STATUS to status.name,
        KEY_IMPORTED to imported,
        KEY_UPDATED to updated,
        KEY_FOUND to found,
        KEY_SYNCED_AT to (syncedAt?.toEpochMilli() ?: -1L),
    )

    companion object {
        private const val PERIODIC_WORK_NAME = "lyftr_cardio_sync"
        const val MANUAL_WORK_NAME = "lyftr_cardio_sync_manual"

        const val STATUS = "status"
        const val KEY_IMPORTED = "imported"
        const val KEY_UPDATED = "updated"
        const val KEY_FOUND = "found"
        const val KEY_SYNCED_AT = "synced_at"

        /**
         * 4h interval with a 1h flex window: WorkManager/JobScheduler runs the
         * job sometime in the last hour of each period, aligning with a
         * device's normal Doze maintenance window instead of demanding an
         * exact wake — this doesn't add wake-ups over a flat interval, it
         * just gives the system room to batch it cheaply. See the class doc
         * for why this is a ceiling, not a guarantee, and why StatusScreen's
         * on-open check exists to cover the gap.
         */
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<CardioSyncWorker>(4, TimeUnit.HOURS, 1, TimeUnit.HOURS)
                .setConstraints(Constraints(requiredNetworkType = NetworkType.CONNECTED))
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(PERIODIC_WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_WORK_NAME)
        }

        /**
         * Triggered by the "Sync cardio now" button, and by StatusScreen
         * automatically when the last sync looks stale on app open. REPLACE
         * (not KEEP) is required here — KEEP treats any past work under this
         * unique name, including ones that already finished, as "still
         * there" and silently no-ops every call after the first. REPLACE
         * always starts a fresh run.
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

        /** StatusScreen observes this for WorkInfo.nextScheduleTimeMillis — the "Next auto-sync" estimate. */
        fun observePeriodicSync(context: Context): Flow<List<WorkInfo>> =
            WorkManager.getInstance(context).getWorkInfosForUniqueWorkFlow(PERIODIC_WORK_NAME)
    }
}

/** Data.getInt has no nullable form; -1 doubles as "field absent". */
fun Data.statusOrNull(): CardioSyncWorker.Status? =
    getString(CardioSyncWorker.STATUS)?.let { runCatching { CardioSyncWorker.Status.valueOf(it) }.getOrNull() }
