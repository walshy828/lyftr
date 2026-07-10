package com.lyftr.phone.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.lyftr.phone.auth.TokenStore
import com.lyftr.phone.sync.SessionRepository
import com.lyftr.phone.sync.SessionSyncService
import kotlinx.coroutines.launch

/** Read-only glance at the bridge's state — actual workout editing happens on web or the watch. */
@Composable
fun StatusScreen(tokenStore: TokenStore, onLogout: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val session by SessionRepository.raw.collectAsState()
    var syncing by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier.fillMaxWidth().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Connected to ${tokenStore.serverUrl}")
        Text(
            if (session != null) "Syncing an active workout with your watch"
            else "No active workout — start one on web or your watch"
        )
        OutlinedButton(
            enabled = !syncing,
            onClick = {
                syncing = true
                scope.launch {
                    SessionSyncService.checkAndStart(context)
                    syncing = false
                }
            },
        ) { Text(if (syncing) "Checking…" else "Sync now") }
        Button(onClick = onLogout) { Text("Log out") }
    }
}
