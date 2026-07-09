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
 * job is auth + being the always-on bridge between the backend and the
 * watch; the phone UI is just enough to log in and see that the bridge is
 * connected.
 */
@Composable
fun LyftrPhoneApp() {
    val context = LocalContext.current
    val tokenStore = remember { TokenStore(context) }
    val apiClient = remember { LyftrApiClient(tokenStore) }
    var loggedIn by remember { mutableStateOf(tokenStore.isLoggedIn) }

    // Runs whenever `loggedIn` becomes/is true — covers both the moment login
    // succeeds *and* every app relaunch where a prior session is already
    // stored (SessionSyncService is a foreground service tied to the process,
    // so it does not survive the process being killed and must be
    // re-started here rather than only from the login button's callback).
    LaunchedEffect(loggedIn) {
        if (loggedIn) {
            TokenRefreshWorker.schedule(context)
            SessionSyncService.start(context)
        }
    }

    if (loggedIn) {
        StatusScreen(
            tokenStore = tokenStore,
            onLogout = {
                tokenStore.clear()
                loggedIn = false
            },
        )
    } else {
        LoginScreen(apiClient = apiClient, tokenStore = tokenStore, onLoggedIn = { loggedIn = true })
    }
}
