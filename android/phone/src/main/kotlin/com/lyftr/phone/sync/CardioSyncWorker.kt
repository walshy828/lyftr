package com.lyftr.phone.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.lyftr.phone.auth.LyftrApiClient
import com.lyftr.phone.auth.TokenStore
import com.lyftr.phone.health.HealthConnectSync
import java.time.Instant
import java.util.concurrent.TimeUnit

/**
 * Pulls cardio sessions (runs/rides/walks) the Pixel Watch already recorded
 * into Health Connect and imports any new ones into Lyftr. Mirrors
 * [com.lyftr.phone.auth.TokenRefreshWorker]'s shape: a small periodic
 * WorkManager job, plus [syncNow] for the manual "Sync cardio now" button on
 * StatusScreen, both funneling through the same one-time work request so they
 * never race each other.
 *
 * The watermark (TokenStore.lastCardioSyncAt) is only advanced after a
 * successful import — a failed run is retried from the same starting point
 * rather than silently dropping sessions.
 */
class CardioSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val tokenStore = TokenStore(applicationContext)
        if (!tokenStore.isLoggedIn) return Result.success()
        if (!HealthConnectSync.isAvailable(applicationContext)) return Result.success()

        val client = HealthConnectSync.client(applicationContext)
        if (!HealthConnectSync.hasPermissions(client)) return Result.success()

        val since = tokenStore.lastCardioSyncAt ?: Instant.EPOCH
        val runStartedAt = Instant.now()
        val sessions = HealthConnectSync.readCardioSessionsSince(client, since)
        if (sessions.isEmpty()) {
            tokenStore.lastCardioSyncAt = runStartedAt
            return Result.success()
        }

        val imported = LyftrApiClient(tokenStore).importCardioSessions(sessions)
            ?: return Result.retry()

        tokenStore.lastCardioSyncAt = runStartedAt
        return Result.success()
    }

    companion object {
        private const val PERIODIC_WORK_NAME = "lyftr_cardio_sync"
        private const val MANUAL_WORK_NAME = "lyftr_cardio_sync_manual"

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

        /** Triggered by the "Sync cardio now" button — runs the same worker on demand. */
        fun syncNow(context: Context) {
            val request = OneTimeWorkRequestBuilder<CardioSyncWorker>()
                .setConstraints(Constraints(requiredNetworkType = NetworkType.CONNECTED))
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(MANUAL_WORK_NAME, ExistingWorkPolicy.KEEP, request)
        }
    }
}
