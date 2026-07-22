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
 * Foreground service that owns the phone <-> backend <-> watch session sync
 * loop *while a workout is in progress* — and only then:
 *  - polls GET /api/v1/active-session and republishes any change to the
 *    watch via [WearBridge];
 *  - on [ACTION_PUSH] (fired by [WearListenerService] after a watch action
 *    has been applied to [SessionRepository]), immediately PUTs the updated
 *    blob back to the backend and republishes to the watch;
 *  - stops itself once the session ends (or auth is lost), publishing an
 *    inactive DataItem so the watch clears its UI and its own FGS.
 *
 * When no workout is active the service is not running at all — it is only
 * started by [checkAndStart] (app open / watch REQUEST_SESSION) after a
 * one-shot fetch confirms a session exists. START_NOT_STICKY: if the system
 * kills the process mid-workout, the next watch interaction re-wakes the
 * bridge via [WearListenerService].
 *
 * The FGS type stays `dataSync` (not `connectedDevice`): connectedDevice
 * requires an eligibility permission like BLUETOOTH_CONNECT on Android 14+,
 * and Android 15's 6h/24h dataSync budget is irrelevant for a service that
 * only lives for the duration of a workout.
 */
class SessionSyncService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var pollJob: Job? = null

    /** Consecutive polls that found no session on the backend. */
    private var missCount = 0

    /** Whether any poll (or the starting one-shot fetch) has seen a session. */
    private var hadSession = false

    private lateinit var tokenStore: TokenStore
    private lateinit var apiClient: LyftrApiClient
    private lateinit var wearBridge: WearBridge

    override fun onCreate() {
        super.onCreate()
        tokenStore = TokenStore(this)
        apiClient = LyftrApiClient(tokenStore)
        wearBridge = WearBridge(this)
        startForeground(NOTIFICATION_ID, buildNotification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PUSH -> scope.launch { pushLocalChanges() }
            ACTION_FINISH -> {
                val feeling = intent.getIntExtra(EXTRA_FEELING, 0)
                scope.launch { finishWorkout(feeling) }
                return START_NOT_STICKY
            }
        }
        // Every start path runs the self-terminating poll loop, so however the
        // service came up it always ends when the session does.
        startPolling()
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun startPolling() {
        if (pollJob?.isActive == true) return
        hadSession = SessionRepository.rawJsonString() != null
        missCount = 0
        pollJob = scope.launch {
            while (true) {
                if (!tokenStore.isLoggedIn) {
                    shutDown("logged out")
                    return@launch
                }
                if (!pollOnce()) {
                    shutDown(if (hadSession) "session ended" else "no session found")
                    return@launch
                }
                delay(POLL_INTERVAL_MS)
            }
        }
    }

    /**
     * One poll round-trip. Returns false once the loop should stop: the
     * session we were tracking disappeared (finished/discarded on web), or
     * repeated polls confirmed there is nothing to sync. A single null while
     * we've never seen a session is retried once ([MAX_MISSES]) to ride out a
     * transient network/backend blip right after start.
     */
    private suspend fun pollOnce(): Boolean {
        val serverJson = apiClient.getActiveSession()
        if (serverJson == null) {
            missCount++
            return !hadSession && missCount < MAX_MISSES
        }
        missCount = 0
        hadSession = true
        if (serverJson != SessionRepository.rawJsonString()) {
            SessionRepository.setFromServerJson(serverJson)
            wearBridge.publish(SessionRepository.toWearSession())
        }
        return true
    }

    /** Publishes the inactive state to the watch, clears local state, and stops. */
    private suspend fun shutDown(reason: String) {
        Log.i(TAG, "SessionSyncService stopping: $reason")
        SessionRepository.clear()
        wearBridge.publish(null)
        stopSelf()
    }

    /** Pushes SessionRepository's current (watch-mutated) state to the backend and watch. */
    private suspend fun pushLocalChanges() {
        val sessionJson = SessionRepository.rawJsonString() ?: return
        if (!apiClient.putActiveSession(sessionJson)) {
            Log.w(TAG, "pushLocalChanges: PUT active-session failed; will reconcile on next poll")
        }
        wearBridge.publish(SessionRepository.toWearSession())
    }

    /**
     * Persists the workout ended from the watch (early or after the last set),
     * mirroring web's handleFinish (GymModeWorkout.tsx): POST /workouts with
     * whatever is in the session right now, then delete the active-session
     * blob and clear the watch. Stops the poll loop first so a poll in flight
     * can't re-hydrate SessionRepository out from under us right as we're
     * about to delete the session it would have re-fetched.
     */
    private suspend fun finishWorkout(feeling: Int = 0) {
        pollJob?.cancel()
        pollJob = null

        if (SessionRepository.rawJsonString() == null) {
            // Cold-started by the watch's message waking a dead process —
            // resync from the backend before we have anything to finish.
            SessionSyncService.checkAndStart(applicationContext)
        }
        val req = SessionRepository.toCreateWorkoutRequest(feeling)
        if (req == null) {
            Log.w(TAG, "finishWorkout: no session to finish")
            return
        }
        if (!apiClient.createWorkout(req)) {
            Log.e(TAG, "finishWorkout: createWorkout failed, leaving active-session intact for retry")
            startPolling()
            return
        }
        apiClient.deleteActiveSession() // best-effort; workout is already saved either way
        shutDown("workout finished from watch")
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
        private const val POLL_INTERVAL_MS = 10_000L
        private const val MAX_MISSES = 2
        private const val ACTION_PUSH = "com.lyftr.phone.action.PUSH"
        private const val ACTION_FINISH = "com.lyftr.phone.action.FINISH"
        private const val EXTRA_FEELING = "feeling"

        fun start(context: Context) {
            context.startForegroundService(Intent(context, SessionSyncService::class.java))
        }

        /** Called by [WearListenerService] after applying a watch action to [SessionRepository]. */
        fun pushChanges(context: Context) {
            val intent = Intent(context, SessionSyncService::class.java).setAction(ACTION_PUSH)
            context.startForegroundService(intent)
        }

        /** Called by [WearListenerService] when the watch sends END_WORKOUT. */
        fun finishWorkout(context: Context, feeling: Int? = null) {
            val intent = Intent(context, SessionSyncService::class.java)
                .setAction(ACTION_FINISH)
                .putExtra(EXTRA_FEELING, feeling ?: 0)
            context.startForegroundService(intent)
        }

        /**
         * One-shot: fetch the backend's active session, publish the result to
         * the watch (active or not, so the watch always gets an answer), and
         * start the sync service only if a workout is actually in progress.
         * Returns true when a session was found. This is the sole entry point
         * that brings the bridge up — from the phone app opening, the status
         * screen's "Sync now", or the watch's REQUEST_SESSION message.
         */
        suspend fun checkAndStart(context: Context): Boolean {
            val tokenStore = TokenStore(context)
            if (!tokenStore.isLoggedIn) return false
            val serverJson = LyftrApiClient(tokenStore).getActiveSession()
            SessionRepository.setFromServerJson(serverJson)
            WearBridge(context).publish(SessionRepository.toWearSession())
            if (serverJson == null) return false
            start(context)
            return true
        }
    }
}
