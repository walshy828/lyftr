package com.lyftr.wear

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.wear.ongoing.OngoingActivity

private const val TAG = "LyftrSync"

/**
 * Foreground service that exists purely to keep the workout session "sticky"
 * on the watch while one is active:
 *  - the OngoingActivity ties it to the watch face's ongoing-activity
 *    indicator (same affordance fitness apps use), so when the system does
 *    drop back to the watch face, one tap on the indicator returns to the
 *    app — no digging through recents;
 *  - holding a foreground service raises the app's process priority so the
 *    system stops evicting it between glances.
 * Started/stopped from MainActivity and SessionListenerService as the
 * session appears/disappears.
 */
class OngoingWorkoutService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Active workout", NotificationManager.IMPORTANCE_LOW)
        )
        val touchIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_workout)
            .setContentTitle("Workout in progress")
            .setContentText("Tap to manage your sets")
            .setContentIntent(touchIntent)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)

        // Must be attached to the builder before the notification is posted.
        OngoingActivity.Builder(applicationContext, NOTIFICATION_ID, builder)
            .setStaticIcon(R.drawable.ic_workout)
            .setTouchIntent(touchIntent)
            .build()
            .apply(applicationContext)

        startForeground(NOTIFICATION_ID, builder.build())
        return START_STICKY
    }

    companion object {
        private const val CHANNEL_ID = "lyftr_ongoing_workout"
        private const val NOTIFICATION_ID = 2001
        private const val ACTION_STOP = "com.lyftr.wear.action.STOP"

        fun start(context: Context) {
            // Starting an FGS from the background (e.g. from
            // SessionListenerService while the app isn't visible) can throw
            // on Android 12+; MainActivity re-triggers this on next open, so
            // a swallowed failure here only costs the indicator until then.
            runCatching { context.startForegroundService(Intent(context, OngoingWorkoutService::class.java)) }
                .onFailure { Log.w(TAG, "OngoingWorkoutService start rejected (backgrounded?)", it) }
        }

        fun stop(context: Context) {
            runCatching {
                context.startService(Intent(context, OngoingWorkoutService::class.java).setAction(ACTION_STOP))
            }
        }
    }
}
