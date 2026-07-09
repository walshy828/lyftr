package com.lyftr.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.CircularProgressIndicator
import kotlinx.coroutines.delay

/**
 * Countdown computed locally from the absolute [endsAtMillis] the phone
 * relayed (mirroring web/src/stores/workoutSession.ts's rest timer, which is
 * also an absolute end-stamp) — no need for a tick from the phone.
 */
@Composable
fun RestTimerScreen(endsAtMillis: Long, exerciseName: String) {
    val remainingMs by produceState(initialValue = (endsAtMillis - System.currentTimeMillis()).coerceAtLeast(0)) {
        while (true) {
            value = (endsAtMillis - System.currentTimeMillis()).coerceAtLeast(0)
            if (value <= 0) break
            delay(250)
        }
    }
    val remainingSec = (remainingMs / 1000).toInt()

    Box(modifier = Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            CircularProgressIndicator(modifier = Modifier.size(64.dp))
            Text(
                text = "%d:%02d".format(remainingSec / 60, remainingSec % 60),
                style = MaterialTheme.typography.display2,
            )
            Text(text = "Resting · $exerciseName", style = MaterialTheme.typography.caption2, textAlign = TextAlign.Center)
        }
    }
}
