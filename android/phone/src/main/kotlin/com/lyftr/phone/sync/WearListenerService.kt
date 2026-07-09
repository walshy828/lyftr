package com.lyftr.phone.sync

import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import com.lyftr.shared.WearAction
import com.lyftr.shared.WearPaths

/**
 * Registered in AndroidManifest.xml with an intent-filter for
 * [WearPaths.ACTION] messages, so Play Services can wake this up to receive
 * a watch action even if [SessionSyncService] isn't currently running.
 */
class WearListenerService : WearableListenerService() {
    override fun onMessageReceived(messageEvent: MessageEvent) {
        if (!messageEvent.path.startsWith(WearPaths.ACTION)) return
        val action = runCatching {
            WearAction.fromJson(String(messageEvent.data, Charsets.UTF_8))
        }.getOrNull() ?: return

        if (SessionRepository.applyAction(action)) {
            SessionSyncService.pushChanges(applicationContext)
        }
    }
}
