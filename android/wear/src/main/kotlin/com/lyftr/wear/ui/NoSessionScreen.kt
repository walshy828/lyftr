package com.lyftr.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text

@Composable
fun NoSessionScreen(checking: Boolean, onRefresh: () -> Unit) {
    Box(modifier = Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                text = "No active workout",
                style = MaterialTheme.typography.title3,
                textAlign = TextAlign.Center,
            )
            Text(
                text = "Start one on your phone or web",
                style = MaterialTheme.typography.caption2,
                textAlign = TextAlign.Center,
            )
            Chip(
                onClick = onRefresh,
                enabled = !checking,
                colors = ChipDefaults.secondaryChipColors(),
                label = {
                    Text(
                        text = if (checking) "Checking…" else "Check again",
                        style = MaterialTheme.typography.caption1,
                    )
                },
            )
        }
    }
}

@Composable
fun WorkoutCompleteScreen(workoutName: String, onFinish: () -> Unit) {
    Box(modifier = Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(text = "$workoutName done", style = MaterialTheme.typography.title3, textAlign = TextAlign.Center)
            Text(text = "All sets complete", style = MaterialTheme.typography.caption2, textAlign = TextAlign.Center)
            Chip(
                onClick = onFinish,
                colors = ChipDefaults.primaryChipColors(),
                label = { Text("Finish", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
