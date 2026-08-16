package com.lyftr.phone.sync

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity

/**
 * Invisible entry point for lyftr://sync?returnTo=<url> — the web PWA's
 * "Refresh" button navigates here to trigger a same-device sync without
 * requiring the user to open this app directly. No UI is ever composed: it
 * kicks off an expedited [CardioSyncWorker] run, bounces straight back to
 * the browser tab named in returnTo, and finishes. See the manifest entry
 * (Theme.NoDisplay, noHistory) for why the app-switch is meant
 * to be imperceptible rather than a real screen.
 */
class SyncTriggerActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CardioSyncWorker.syncNow(applicationContext, expedited = true)
        intent?.data?.getQueryParameter("returnTo")?.let { returnTo ->
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(returnTo)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        finish()
    }
}
