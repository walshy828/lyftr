package com.lyftr.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.CompactButton
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.lyftr.shared.WearExercise
import com.lyftr.shared.WearSession
import com.lyftr.shared.WearSet
import kotlin.math.roundToInt

private const val WEIGHT_STEP = 5.0

@Composable
fun ActiveSetScreen(
    session: WearSession,
    exercise: WearExercise,
    set: WearSet,
    onComplete: () -> Unit,
    onSkip: () -> Unit,
    onWeightChange: (Double) -> Unit,
    onRepsChange: (Int) -> Unit,
) {
    val restEndsAt = session.rest_ends_at
    if (restEndsAt != null && restEndsAt > System.currentTimeMillis()) {
        RestTimerScreen(endsAtMillis = restEndsAt, exerciseName = exercise.exercise_name)
        return
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            text = exercise.exercise_name,
            style = MaterialTheme.typography.title3,
            textAlign = TextAlign.Center,
            maxLines = 2,
        )
        Text(
            text = "Set ${set.set_number} of ${exercise.sets.size}",
            style = MaterialTheme.typography.caption2,
        )

        Stepper(
            label = "lb",
            value = displayWeight(set),
            onIncrement = { onWeightChange(displayWeight(set) + WEIGHT_STEP) },
            onDecrement = { onWeightChange((displayWeight(set) - WEIGHT_STEP).coerceAtLeast(0.0)) },
            format = { it.roundToInt().toString() },
        )
        Stepper(
            label = "reps",
            value = displayReps(set).toDouble(),
            onIncrement = { onRepsChange(displayReps(set) + 1) },
            onDecrement = { onRepsChange((displayReps(set) - 1).coerceAtLeast(0)) },
            format = { it.roundToInt().toString() },
        )

        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            CompactButton(onClick = onSkip, colors = ButtonDefaults.secondaryButtonColors()) {
                Text("Skip")
            }
            Button(onClick = onComplete) {
                Text("Done")
            }
        }
    }
}

// The web app only shows actual_* once it's non-zero; before that it falls
// back to the target, matching web/src/pages/GymModeWorkout.tsx's display logic.
private fun displayWeight(set: WearSet) = if (set.actual_weight > 0) set.actual_weight else set.target_weight
private fun displayReps(set: WearSet) = if (set.actual_reps > 0) set.actual_reps else set.target_reps

@Composable
private fun Stepper(
    label: String,
    value: Double,
    onIncrement: () -> Unit,
    onDecrement: () -> Unit,
    format: (Double) -> String,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        CompactButton(onClick = onDecrement) { Text("-") }
        Text(text = "${format(value)} $label", style = MaterialTheme.typography.body1)
        CompactButton(onClick = onIncrement) { Text("+") }
    }
}
