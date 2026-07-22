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

/**
 * Interposed between tapping "End Workout" on [ActiveSetScreen] and actually
 * sending the action, so a stray tap mid-workout can't cut it short by
 * accident. Natural completion (all sets done) skips this screen entirely —
 * see WearApp's allComplete branch — since nothing is being cut short there.
 */
@Composable
fun ConfirmEndWorkoutScreen(onConfirm: () -> Unit, onCancel: () -> Unit) {
    Box(modifier = Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                text = "End workout now?",
                style = MaterialTheme.typography.title3,
                textAlign = TextAlign.Center,
            )
            Text(
                text = "Progress so far will be saved",
                style = MaterialTheme.typography.caption2,
                textAlign = TextAlign.Center,
            )
            Chip(
                onClick = onConfirm,
                colors = ChipDefaults.primaryChipColors(),
                label = { Text("End Workout", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center) },
                modifier = Modifier.fillMaxWidth(),
            )
            Chip(
                onClick = onCancel,
                colors = ChipDefaults.secondaryChipColors(),
                label = { Text("Cancel", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
