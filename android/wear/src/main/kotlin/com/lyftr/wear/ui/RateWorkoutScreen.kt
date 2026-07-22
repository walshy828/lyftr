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
 * Shown right before the END_WORKOUT action is actually sent — both the
 * early-end (post-[ConfirmEndWorkoutScreen]) and natural-completion paths in
 * WearApp converge here. Rating is optional: Skip sends the action unrated.
 */
@Composable
fun RateWorkoutScreen(onRate: (feeling: Int) -> Unit, onSkip: () -> Unit) {
    Box(modifier = Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                text = "How did that feel?",
                style = MaterialTheme.typography.title3,
                textAlign = TextAlign.Center,
            )
            Chip(
                onClick = { onRate(1) },
                colors = ChipDefaults.primaryChipColors(),
                label = { Text("Light", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center) },
                modifier = Modifier.fillMaxWidth(),
            )
            Chip(
                onClick = { onRate(2) },
                colors = ChipDefaults.primaryChipColors(),
                label = { Text("Moderate", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center) },
                modifier = Modifier.fillMaxWidth(),
            )
            Chip(
                onClick = { onRate(3) },
                colors = ChipDefaults.primaryChipColors(),
                label = { Text("Intense", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center) },
                modifier = Modifier.fillMaxWidth(),
            )
            Chip(
                onClick = onSkip,
                colors = ChipDefaults.secondaryChipColors(),
                label = { Text("Skip", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
