package com.lyftr.phone.auth

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Rotates the access/refresh token pair once a day. Day-to-day access-token
 * expiry is already handled on demand by LyftrApiClient's 401-refresh-retry;
 * this worker only exists so the 30-day refresh token (backend/utils/jwt.go)
 * keeps rolling forward during long idle stretches and the user isn't forced
 * to log in again after a month away. One constrained network call per day
 * is the app's entire background footprint when no workout is active.
 */
class TokenRefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val tokenStore = TokenStore(applicationContext)
        if (!tokenStore.isLoggedIn) return Result.success()
        val ok = LyftrApiClient(tokenStore).refresh()
        return if (ok) Result.success() else Result.retry()
    }

    companion object {
        private const val WORK_NAME = "lyftr_token_refresh"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<TokenRefreshWorker>(24, TimeUnit.HOURS)
                .setConstraints(Constraints(requiredNetworkType = NetworkType.CONNECTED))
                .build()
            // UPDATE (not KEEP) so installs that scheduled the old 20-minute
            // cadence pick up the daily one without a reinstall.
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
        }
    }
}
