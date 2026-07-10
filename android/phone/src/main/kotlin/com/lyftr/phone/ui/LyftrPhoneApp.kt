package com.lyftr.phone.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import com.lyftr.phone.auth.LyftrApiClient
import com.lyftr.phone.auth.TokenRefreshWorker
import com.lyftr.phone.auth.TokenStore
import com.lyftr.phone.sync.SessionSyncService

/**
 * This app's UI is deliberately thin — most workout management stays on the
 * web app (see plan: android/README or the repo's top-level CLAUDE.md). Its
 * job is auth + bridging the backend to the watch *while a workout is
 * active*; when nothing is active the app runs no services and makes no
 * network calls. The bridge is brought up on demand by
 * [SessionSyncService.checkAndStart] — from here when the app opens, from
 * the status screen's "Sync now", or from the watch app opening
 * (WearListenerService).
 */
@Composable
fun LyftrPhoneApp() {
    val context = LocalContext.current
    val tokenStore = remember { TokenStore(context) }
    val apiClient = remember { LyftrApiClient(tokenStore) }
    var loggedIn by remember { mutableStateOf(tokenStore.isLoggedIn) }

    // Runs whenever `loggedIn` becomes/is true — the moment login succeeds
    // and every app launch with a stored session: keep the daily token
    // refresh scheduled and do a single active-session check (which starts
    // the sync service only if a workout is in progress).
    LaunchedEffect(loggedIn) {
        if (loggedIn) {
            TokenRefreshWorker.schedule(context)
            SessionSyncService.checkAndStart(context)
        }
    }

    if (loggedIn) {
        StatusScreen(
            tokenStore = tokenStore,
            onLogout = {
                TokenRefreshWorker.cancel(context)
                tokenStore.clear()
                loggedIn = false
            },
        )
    } else {
        LoginScreen(apiClient = apiClient, tokenStore = tokenStore, onLoggedIn = { loggedIn = true })
    }
}
