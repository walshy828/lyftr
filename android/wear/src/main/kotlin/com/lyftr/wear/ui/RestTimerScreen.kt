package com.lyftr.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.lyftr.shared.WearExercise
import com.lyftr.shared.WearSession
import com.lyftr.shared.WearSet
import kotlinx.coroutines.delay

/**
 * Full-screen rest countdown. The ring hugs the round bezel (a full-screen
 * CircularProgressIndicator is the canonical Wear pattern for "time until
 * the next thing") and drains as the rest elapses. Remaining time is
 * computed locally from the absolute end-stamp the phone relayed — no timer
 * ticks over the Data Layer, mirroring web/src/stores/workoutSession.ts.
 */
@Composable
fun RestTimerScreen(
    endsAtMillis: Long,
    durationSec: Int?,
    session: WearSession,
    exercise: WearExercise,
    set: WearSet,
) {
    val remainingMs by produceState(
        initialValue = (endsAtMillis - System.currentTimeMillis()).coerceAtLeast(0),
        endsAtMillis,
    ) {
        while (true) {
            value = (endsAtMillis - System.currentTimeMillis()).coerceAtLeast(0)
            if (value <= 0) break
            delay(250)
        }
    }
    val remainingSec = (remainingMs / 1000).toInt()
    val totalMs = (durationSec ?: 0) * 1000L
    val progress = if (totalMs > 0) (remainingMs.toFloat() / totalMs).coerceIn(0f, 1f) else 0f
    val elapsed by rememberWorkoutElapsed(session.started_at)

    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(
            progress = progress,
            modifier = Modifier.fillMaxSize().padding(2.dp),
            strokeWidth = 5.dp,
        )
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp),
            modifier = Modifier.padding(horizontal = 28.dp),
        ) {
            Text(
                text = "REST",
                style = MaterialTheme.typography.caption2,
                color = MaterialTheme.colors.secondary,
            )
            Text(
                text = "%d:%02d".format(remainingSec / 60, remainingSec % 60),
                style = MaterialTheme.typography.display1,
            )
            // The phone auto-advances current_set_idx on completion, so what
            // this screen's set/exercise point at is already the *upcoming* set.
            Text(
                text = "Next: set ${set.set_number}/${exercise.sets.size} · ${exercise.exercise_name}",
                style = MaterialTheme.typography.caption2,
                textAlign = TextAlign.Center,
                maxLines = 2,
            )
            Text(
                text = "⏱ $elapsed",
                style = MaterialTheme.typography.caption2,
                color = MaterialTheme.colors.secondary,
            )
        }
    }
}
