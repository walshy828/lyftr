package com.lyftr.phone.sync

import android.util.Log
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import com.lyftr.shared.WearAction
import com.lyftr.shared.WearPaths

private const val TAG = "LyftrSync"

/**
 * Registered in AndroidManifest.xml with an intent-filter for
 * [WearPaths.ACTION] messages, so Play Services can wake this up to receive
 * a watch action even if [SessionSyncService] isn't currently running.
 */
class WearListenerService : WearableListenerService() {
    override fun onMessageReceived(messageEvent: MessageEvent) {
        Log.d(TAG, "onMessageReceived: path=${messageEvent.path}")
        if (!messageEvent.path.startsWith(WearPaths.ACTION)) return
        val action = runCatching {
            WearAction.fromJson(String(messageEvent.data, Charsets.UTF_8))
        }.onFailure { Log.e(TAG, "onMessageReceived: failed to parse action", it) }.getOrNull() ?: return

        Log.d(TAG, "onMessageReceived: action=$action")
        if (SessionRepository.applyAction(action)) {
            SessionSyncService.pushChanges(applicationContext)
        } else {
            Log.w(TAG, "onMessageReceived: applyAction returned false (stale indices?)")
        }
    }
}
