package com.lyftr.phone.auth

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Rotates the access/refresh token pair every 20 minutes — comfortably inside
 * the backend's 1-hour access-token lifetime (backend/utils/jwt.go) even if a
 * couple of runs get delayed by Doze/battery restrictions. The 30-day refresh
 * token means a user who never opens the phone app for a month will need to
 * log in again; that's an accepted limitation, not a bug, per the plan.
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
            val request = PeriodicWorkRequestBuilder<TokenRefreshWorker>(20, TimeUnit.MINUTES).build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}
