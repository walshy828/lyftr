package com.lyftr.phone.sync

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.lyftr.phone.R
import com.lyftr.phone.auth.LyftrApiClient
import com.lyftr.phone.auth.TokenStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Foreground service that is the sole owner of the phone <-> backend <->
 * watch session sync loop:
 *  - polls GET /api/v1/active-session while a session exists (or none is
 *    known yet) and republishes any change to the watch via [WearBridge].
 *  - on [ACTION_PUSH] (fired by [WearListenerService] after a watch action
 *    has been applied to [SessionRepository]), immediately PUTs the updated
 *    blob back to the backend and republishes to the watch.
 * Runs as a foreground service (not a plain background coroutine) so the
 * poll loop and Data Layer bridge survive Doze/background execution limits
 * while a workout is in progress — see AndroidManifest.xml's
 * FOREGROUND_SERVICE_DATA_SYNC permission.
 */
class SessionSyncService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var pollJob: Job? = null

    private lateinit var tokenStore: TokenStore
    private lateinit var apiClient: LyftrApiClient
    private lateinit var wearBridge: WearBridge

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "onCreate")
        tokenStore = TokenStore(this)
        apiClient = LyftrApiClient(tokenStore)
        wearBridge = WearBridge(this)
        startForeground(NOTIFICATION_ID, buildNotification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand action=${intent?.action}")
        when (intent?.action) {
            ACTION_PUSH -> scope.launch { pushLocalChanges() }
            else -> startPolling()
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        Log.d(TAG, "onDestroy")
        scope.cancel()
        super.onDestroy()
    }

    private fun startPolling() {
        if (pollJob?.isActive == true) {
            Log.d(TAG, "startPolling: already running")
            return
        }
        Log.d(TAG, "startPolling: launching poll loop, isLoggedIn=${tokenStore.isLoggedIn}")
        pollJob = scope.launch {
            while (true) {
                if (tokenStore.isLoggedIn) pollOnce()
                delay(POLL_INTERVAL_MS)
            }
        }
    }

    private suspend fun pollOnce() {
        val serverJson = apiClient.getActiveSession()
        val localJson = SessionRepository.rawJsonString()
        Log.d(TAG, "pollOnce: server=${serverJson?.take(80)} changed=${serverJson != localJson}")
        if (serverJson != localJson) {
            SessionRepository.setFromServerJson(serverJson)
            val wearSession = SessionRepository.toWearSession()
            Log.d(TAG, "pollOnce: publishing to watch, active=${wearSession != null}")
            wearBridge.publish(wearSession)
        }
    }

    /** Pushes SessionRepository's current (watch-mutated) state to the backend and watch. */
    private suspend fun pushLocalChanges() {
        val sessionJson = SessionRepository.rawJsonString()
        Log.d(TAG, "pushLocalChanges: sessionJson=${sessionJson?.take(80)}")
        if (sessionJson == null) return
        val putOk = apiClient.putActiveSession(sessionJson)
        Log.d(TAG, "pushLocalChanges: PUT ok=$putOk")
        wearBridge.publish(SessionRepository.toWearSession())
    }

    private fun buildNotification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Workout sync", NotificationManager.IMPORTANCE_LOW)
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Lyftr")
            .setContentText("Syncing your workout with your watch")
            .setSmallIcon(R.drawable.ic_sync)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val TAG = "LyftrSync"
        private const val CHANNEL_ID = "lyftr_sync"
        private const val NOTIFICATION_ID = 1001
        private const val POLL_INTERVAL_MS = 7_000L
        private const val ACTION_PUSH = "com.lyftr.phone.action.PUSH"

        fun start(context: Context) {
            context.startForegroundService(Intent(context, SessionSyncService::class.java))
        }

        /** Called by [WearListenerService] after applying a watch action to [SessionRepository]. */
        fun pushChanges(context: Context) {
            val intent = Intent(context, SessionSyncService::class.java).setAction(ACTION_PUSH)
            context.startForegroundService(intent)
        }
    }
}
