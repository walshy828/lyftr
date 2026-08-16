package com.lyftr.phone.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.Watch
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.work.WorkInfo
import com.lyftr.phone.auth.SyncLogEntry
import com.lyftr.phone.auth.TokenStore
import com.lyftr.phone.health.HealthConnectSync
import com.lyftr.phone.sync.CardioSyncWorker
import com.lyftr.phone.sync.SessionRepository
import com.lyftr.phone.sync.SessionSyncService
import com.lyftr.phone.sync.statusOrNull
import com.lyftr.phone.ui.theme.LyftrBrandHeader
import com.lyftr.phone.ui.theme.LyftrColors
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.launch

private val SYNC_TIME_FORMAT = DateTimeFormatter.ofPattern("MMM d, h:mm a")

/** How long a "last synced" watermark can go before StatusScreen kicks off a catch-up sync on open. */
private const val STALE_AFTER_MS = 2 * 60 * 60 * 1000L

private fun formatSyncedAt(at: Instant): String =
    SYNC_TIME_FORMAT.format(at.atZone(ZoneId.systemDefault()))

/** "in about 40 min" / "in about 2h 15m" / "due now" — used for both the next-sync estimate and history rows. */
private fun formatRelative(targetMillis: Long, nowMillis: Long = System.currentTimeMillis()): String {
    val diff = targetMillis - nowMillis
    return when {
        diff <= 0 -> "due now"
        diff < 60_000 -> "in under a minute"
        diff < 3_600_000 -> "in about ${diff / 60_000} min"
        else -> {
            val hours = diff / 3_600_000
            val minutes = (diff % 3_600_000) / 60_000
            if (minutes == 0L) "in about ${hours}h" else "in about ${hours}h ${minutes}m"
        }
    }
}

/** "3 min ago" / "5h ago" — for sync history rows, which are always in the past. */
private fun formatAgo(atMillis: Long, nowMillis: Long = System.currentTimeMillis()): String {
    val diff = (nowMillis - atMillis).coerceAtLeast(0)
    return when {
        diff < 60_000 -> "just now"
        diff < 3_600_000 -> "${diff / 60_000} min ago"
        diff < 86_400_000 -> "${diff / 3_600_000}h ago"
        else -> formatSyncedAt(Instant.ofEpochMilli(atMillis))
    }
}

/** Human-readable outcome for a sync attempt, shared by the live status line and the history list. */
private fun syncStatusText(status: CardioSyncWorker.Status?, imported: Int, updated: Int): String = when (status) {
    CardioSyncWorker.Status.OK -> when {
        imported > 0 && updated > 0 ->
            "Synced $imported new session${if (imported == 1) "" else "s"}, $updated updated"
        imported > 0 -> "Synced $imported new session${if (imported == 1) "" else "s"}"
        updated > 0 -> "Updated $updated session${if (updated == 1) "" else "s"}"
        else -> "Up to date — no new sessions"
    }
    CardioSyncWorker.Status.NOT_LOGGED_IN -> "Not logged in"
    CardioSyncWorker.Status.HEALTH_CONNECT_UNAVAILABLE -> "Health Connect isn't available on this device"
    CardioSyncWorker.Status.PERMISSION_NOT_GRANTED -> "Health Connect permission isn't granted"
    CardioSyncWorker.Status.IMPORT_FAILED -> "Sync failed — check your connection and try again"
    CardioSyncWorker.Status.READ_FAILED -> "Couldn't read Health Connect — try syncing again"
    null -> "Sync failed — check your connection and try again"
}

/** Human-readable outcome of the most recent manual/on-open "Sync cardio now" run, or null while nothing has happened yet. */
private fun manualSyncStatusText(info: WorkInfo?): String? = when (info?.state) {
    WorkInfo.State.ENQUEUED, WorkInfo.State.RUNNING -> "Syncing…"
    WorkInfo.State.SUCCEEDED -> syncStatusText(
        info.outputData.statusOrNull(),
        info.outputData.getInt(CardioSyncWorker.KEY_IMPORTED, 0),
        info.outputData.getInt(CardioSyncWorker.KEY_UPDATED, 0),
    )
    WorkInfo.State.FAILED -> syncStatusText(info.outputData.statusOrNull(), 0, 0)
    else -> null
}

@Composable
private fun ConnectionPill(serverUrl: String?) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        androidx.compose.foundation.layout.Box(
            modifier = Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(LyftrColors.Success500),
        )
        androidx.compose.foundation.layout.Spacer(modifier = Modifier.padding(horizontal = 4.dp))
        Text(
            "Connected to ${serverUrl ?: "?"}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.7f),
        )
    }
}

@Composable
private fun SectionCard(content: @Composable ColumnScope.() -> Unit) {
    Card(elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            content = content,
        )
    }
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
    var syncLog by remember { mutableStateOf(tokenStore.syncLog) }
    val permissionLauncher = rememberLauncherForActivityResult(
        HealthConnectSync.permissionRequestContract(),
    ) { granted -> cardioPermissionGranted = granted.containsAll(HealthConnectSync.PERMISSIONS) }

    LaunchedEffect(healthConnectAvailable) {
        if (healthConnectAvailable) {
            cardioPermissionGranted = HealthConnectSync.hasPermissions(HealthConnectSync.client(context))
            if (cardioPermissionGranted) {
                CardioSyncWorker.schedule(context)
                // Opening the app is the cheapest possible moment to catch up
                // a sync that Doze/App Standby deferred past the periodic
                // interval — costs nothing extra since the device is already
                // awake and the user is already here. See CardioSyncWorker's
                // class doc for why the periodic interval alone can't
                // guarantee freshness.
                val lastSync = tokenStore.lastCardioSyncAt
                if (lastSync == null || System.currentTimeMillis() - lastSync.toEpochMilli() > STALE_AFTER_MS) {
                    CardioSyncWorker.syncNow(context)
                }
            }
        }
    }

    // Reflects both the manual button and the on-open catch-up sync — either
    // one writes the same TokenStore watermark and shows up here.
    val manualSyncWorkInfos by remember(context) { CardioSyncWorker.observeManualSync(context) }
        .collectAsState(initial = emptyList())
    val latestManualSync = manualSyncWorkInfos.firstOrNull()

    // The periodic background job — only used here for its
    // nextScheduleTimeMillis (the "Next auto-sync" estimate), not its result
    // (that's covered by the log refresh below regardless of which path ran).
    val periodicSyncWorkInfos by remember(context) { CardioSyncWorker.observePeriodicSync(context) }
        .collectAsState(initial = emptyList())
    val latestPeriodicSync = periodicSyncWorkInfos.firstOrNull()

    LaunchedEffect(latestManualSync?.state, latestPeriodicSync?.state) {
        val manualDone = latestManualSync?.state == WorkInfo.State.SUCCEEDED || latestManualSync?.state == WorkInfo.State.FAILED
        val periodicDone = latestPeriodicSync?.state == WorkInfo.State.SUCCEEDED || latestPeriodicSync?.state == WorkInfo.State.FAILED
        if (manualDone || periodicDone) {
            lastSyncedAt = tokenStore.lastCardioSyncAt
            syncLog = tokenStore.syncLog
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            LyftrBrandHeader(markSize = 28.dp)
        }
        ConnectionPill(tokenStore.serverUrl)

        SectionCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Watch, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                androidx.compose.foundation.layout.Spacer(modifier = Modifier.padding(horizontal = 4.dp))
                Text("Watch sync", style = MaterialTheme.typography.titleMedium)
            }
            Text(
                if (session != null) "Syncing an active workout with your watch"
                else "No active workout — start one on web or your watch",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.75f),
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
        }

        if (healthConnectAvailable) {
            SectionCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.FavoriteBorder, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    androidx.compose.foundation.layout.Spacer(modifier = Modifier.padding(horizontal = 4.dp))
                    Text("Health Connect", style = MaterialTheme.typography.titleMedium)
                }
                if (cardioPermissionGranted) {
                    Text(
                        "Cardio sessions from your watch sync automatically",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.75f),
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Sync, contentDescription = null, modifier = Modifier.size(16.dp))
                        androidx.compose.foundation.layout.Spacer(modifier = Modifier.padding(horizontal = 2.dp))
                        OutlinedButton(onClick = { CardioSyncWorker.syncNow(context) }) {
                            Text("Sync cardio now")
                        }
                    }
                    manualSyncStatusText(latestManualSync)?.let { status ->
                        Text(status, style = MaterialTheme.typography.bodySmall)
                    }
                    lastSyncedAt?.let { at ->
                        Text(
                            "Last synced: ${formatSyncedAt(at)}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
                        )
                    }
                    val nextScheduleMillis = latestPeriodicSync?.nextScheduleTimeMillis
                    Text(
                        if (nextScheduleMillis != null && nextScheduleMillis > 0) {
                            "Next auto-sync: ${formatRelative(nextScheduleMillis)}"
                        } else {
                            "Next auto-sync: after your next app open"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
                    )
                    Text(
                        "Android may delay background syncs to save battery — opening the app also checks for updates.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.5f),
                    )
                } else {
                    Text(
                        "Grant Health Connect access to import cardio sessions from your watch",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.75f),
                    )
                    OutlinedButton(onClick = { permissionLauncher.launch(HealthConnectSync.PERMISSIONS) }) {
                        Text("Connect Health Connect")
                    }
                }
            }
        }

        if (syncLog.isNotEmpty()) {
            SectionCard {
                Text("Sync history", style = MaterialTheme.typography.titleMedium)
                syncLog.forEach { entry -> SyncLogRow(entry) }
            }
        }

        TextButton(onClick = onLogout) {
            Text("Log out", color = MaterialTheme.colorScheme.error)
        }
    }
}

@Composable
private fun SyncLogRow(entry: SyncLogEntry) {
    val status = runCatching { CardioSyncWorker.Status.valueOf(entry.status) }.getOrNull()
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            syncStatusText(status, entry.imported, entry.updated),
            style = MaterialTheme.typography.bodySmall,
            color = if (status == CardioSyncWorker.Status.OK) {
                MaterialTheme.colorScheme.onBackground.copy(alpha = 0.75f)
            } else {
                MaterialTheme.colorScheme.error
            },
            modifier = Modifier.weight(1f),
        )
        Text(
            formatAgo(entry.at),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.5f),
        )
    }
}
