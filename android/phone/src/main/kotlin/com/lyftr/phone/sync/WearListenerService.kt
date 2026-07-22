package com.lyftr.phone.sync

import android.util.Log
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import com.lyftr.shared.WearAction
import com.lyftr.shared.WearActionType
import com.lyftr.shared.WearPaths
import kotlinx.coroutines.runBlocking

private const val TAG = "LyftrSync"

/**
 * Registered in AndroidManifest.xml with intent-filters for [WearPaths.ACTION]
 * and [WearPaths.REQUEST_SESSION] messages, so Play Services can wake this up
 * even when nothing else in the app is running. This is what lets the phone
 * bridge stay completely inert (no service, no polling) until the watch asks
 * for it: while this service is bound the process is above background
 * priority, so it may legally start [SessionSyncService] as a foreground
 * service. The work is done synchronously ([runBlocking]) because the process
 * only stays alive as long as this callback does.
 */
class WearListenerService : WearableListenerService() {
    override fun onMessageReceived(messageEvent: MessageEvent) {
        when {
            messageEvent.path == WearPaths.REQUEST_SESSION -> {
                // Watch app opened (or user tapped refresh): one-shot fetch +
                // publish, starting the sync service only if a workout exists.
                runBlocking {
                    val active = SessionSyncService.checkAndStart(applicationContext)
                    Log.i(TAG, "REQUEST_SESSION handled, active session: $active")
                }
            }

            messageEvent.path.startsWith(WearPaths.ACTION) -> {
                val action = runCatching {
                    WearAction.fromJson(String(messageEvent.data, Charsets.UTF_8))
                }.onFailure { Log.e(TAG, "onMessageReceived: failed to parse action", it) }.getOrNull() ?: return

                if (action.type == WearActionType.END_WORKOUT) {
                    // Session-level: nothing in SessionRepository to mutate,
                    // go straight to POST /workouts + clear via the sync
                    // service. SessionSyncService.finishWorkout resyncs from
                    // the backend itself if this process was just woken from
                    // scratch and has no in-memory session yet.
                    SessionSyncService.finishWorkout(applicationContext, action.feeling)
                    return
                }

                // applyAction returns false when there's no session in memory
                // (e.g. the workout already ended, or the process was
                // restarted) — in that case don't push, or a stale watch
                // action would resurrect the sync service for nothing.
                if (SessionRepository.applyAction(action)) {
                    SessionSyncService.pushChanges(applicationContext)
                } else if (SessionRepository.rawJsonString() == null) {
                    // Process died mid-workout and lost the in-memory session.
                    // The action itself can't be applied, but resync from the
                    // backend so the watch re-renders the truth and the sync
                    // service comes back up if the workout is still going.
                    Log.w(TAG, "onMessageReceived: no session for $action, resyncing")
                    runBlocking { SessionSyncService.checkAndStart(applicationContext) }
                } else {
                    Log.w(TAG, "onMessageReceived: applyAction dropped $action (stale indices?)")
                }
            }
        }
    }
}
