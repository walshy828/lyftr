package com.lyftr.phone.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.lyftr.phone.auth.TokenStore
import com.lyftr.phone.sync.SessionRepository

/** Read-only glance at the bridge's state — actual workout editing happens on web or the watch. */
@Composable
fun StatusScreen(tokenStore: TokenStore, onLogout: () -> Unit) {
    val session by SessionRepository.raw.collectAsState()

    Column(
        modifier = Modifier.fillMaxWidth().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Connected to ${tokenStore.serverUrl}")
        Text(
            if (session != null) "Syncing an active workout with your watch"
            else "No active workout — start one on web or your watch"
        )
        Button(onClick = onLogout) { Text("Log out") }
    }
}
