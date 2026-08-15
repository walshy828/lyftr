package com.lyftr.phone.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.work.WorkInfo
import com.lyftr.phone.auth.TokenStore
import com.lyftr.phone.health.HealthConnectSync
import com.lyftr.phone.sync.CardioSyncWorker
import com.lyftr.phone.sync.SessionRepository
import com.lyftr.phone.sync.SessionSyncService
import com.lyftr.phone.sync.statusOrNull
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.launch

private val SYNC_TIME_FORMAT = DateTimeFormatter.ofPattern("MMM d, h:mm a")

private fun formatSyncedAt(at: Instant): String =
    SYNC_TIME_FORMAT.format(at.atZone(ZoneId.systemDefault()))

/** Human-readable outcome of the most recent manual "Sync cardio now" run, or null while nothing has happened yet. */
private fun manualSyncStatusText(info: WorkInfo?): String? = when (info?.state) {
    WorkInfo.State.ENQUEUED, WorkInfo.State.RUNNING -> "Syncing…"
    WorkInfo.State.SUCCEEDED -> when (info.outputData.statusOrNull()) {
        CardioSyncWorker.Status.OK -> {
            val imported = info.outputData.getInt(CardioSyncWorker.KEY_IMPORTED, 0)
            if (imported > 0) "Synced $imported new session${if (imported == 1) "" else "s"}"
            else "Up to date — no new sessions"
        }
        CardioSyncWorker.Status.NOT_LOGGED_IN -> "Not logged in"
        CardioSyncWorker.Status.HEALTH_CONNECT_UNAVAILABLE -> "Health Connect isn't available on this device"
        CardioSyncWorker.Status.PERMISSION_NOT_GRANTED -> "Health Connect permission isn't granted"
        else -> null
    }
    WorkInfo.State.FAILED -> "Sync failed — check your connection and try again"
    else -> null
}

/** Read-only glance at the bridge's state — actual workout editing happens on web or the watch. */
@Composable
fun StatusScreen(tokenStore: TokenStore, onLogout: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val session by SessionRepository.raw.collectAsState()
    var syncing by remember { mutableStateOf(false) }

    val healthConnectAvailable = remember { HealthConnectSync.isAvailable(context) }
    var cardioPermissionGranted by remember { mutableStateOf(false) }
    var lastSyncedAt by remember { mutableStateOf(tokenStore.lastCardioSyncAt) }
    val permissionLauncher = rememberLauncherForActivityResult(
        HealthConnectSync.permissionRequestContract(),
    ) { granted -> cardioPermissionGranted = granted.containsAll(HealthConnectSync.PERMISSIONS) }

    LaunchedEffect(healthConnectAvailable) {
        if (healthConnectAvailable) {
            cardioPermissionGranted = HealthConnectSync.hasPermissions(HealthConnectSync.client(context))
            if (cardioPermissionGranted) CardioSyncWorker.schedule(context)
        }
    }

    // Reflects both the manual button and the periodic background job — either
    // one writes the same TokenStore watermark and shows up here.
    val manualSyncWorkInfos by remember(context) { CardioSyncWorker.observeManualSync(context) }
        .collectAsState(initial = emptyList())
    val latestManualSync = manualSyncWorkInfos.firstOrNull()

    LaunchedEffect(latestManualSync?.state) {
        if (latestManualSync?.state == WorkInfo.State.SUCCEEDED) {
            lastSyncedAt = tokenStore.lastCardioSyncAt
        }
    }

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

        if (healthConnectAvailable) {
            if (cardioPermissionGranted) {
                Text("Cardio sessions from your watch sync automatically")
                OutlinedButton(onClick = { CardioSyncWorker.syncNow(context) }) {
                    Text("Sync cardio now")
                }
                manualSyncStatusText(latestManualSync)?.let { status ->
                    Text(status, style = MaterialTheme.typography.bodySmall)
                }
                lastSyncedAt?.let { at ->
                    Text("Last synced: ${formatSyncedAt(at)}", style = MaterialTheme.typography.bodySmall)
                }
            } else {
                Text("Grant Health Connect access to import cardio sessions from your watch")
                OutlinedButton(onClick = { permissionLauncher.launch(HealthConnectSync.PERMISSIONS) }) {
                    Text("Connect Health Connect")
                }
            }
        }

        Button(onClick = onLogout) { Text("Log out") }
    }
}
