package com.lyftr.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.Vignette
import androidx.wear.compose.material.VignettePosition
import com.lyftr.shared.WearExercise
import kotlinx.coroutines.delay
import com.lyftr.shared.WearSession
import com.lyftr.shared.WearSet
import kotlin.math.roundToInt

private const val WEIGHT_STEP = 5.0

/**
 * Round-screen layout notes: everything lives in a ScalingLazyColumn, which
 * insets and curves content away from the circular bezel and makes the
 * screen scrollable (rotating side button / swipe) — a plain Column clipped
 * the action buttons off the bottom on the Pixel Watch. Buttons are stacked
 * full-width Chips rather than a side-by-side Row, since a Row's outer
 * halves fall outside the circle at the screen's bottom.
 */
@Composable
fun ActiveSetScreen(
    session: WearSession,
    exercise: WearExercise,
    set: WearSet,
    onComplete: () -> Unit,
    onSkip: () -> Unit,
    onWeightChange: (Double) -> Unit,
    onRepsChange: (Int) -> Unit,
    onSkipRest: () -> Unit,
    onAdjustRest: (Int) -> Unit,
) {
    val restEndsAt = session.rest_ends_at
    // Ticking state, not a plain comparison: when the countdown expires this
    // must recompose back to the set view on its own — a one-shot check at
    // composition time left the UI stranded on "0:00" until the next Data
    // Layer update happened to arrive.
    val resting by produceState(
        initialValue = restEndsAt != null && restEndsAt > System.currentTimeMillis(),
        restEndsAt,
    ) {
        while (restEndsAt != null && restEndsAt > System.currentTimeMillis()) {
            value = true
            delay(250)
        }
        value = false
    }
    if (resting && restEndsAt != null) {
        RestTimerScreen(
            endsAtMillis = restEndsAt,
            durationSec = session.rest_duration_sec,
            session = session,
            exercise = exercise,
            set = set,
            onSkipRest = onSkipRest,
            onAdjustRest = onAdjustRest,
        )
        return
    }

    val elapsed by rememberWorkoutElapsed(session.started_at)
    val listState = rememberScalingLazyListState()

    Scaffold(
        timeText = { TimeText() },
        vignette = { Vignette(vignettePosition = VignettePosition.TopAndBottom) },
    ) {
        ScalingLazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            item {
                Text(
                    text = "⏱ $elapsed",
                    style = MaterialTheme.typography.caption1,
                    color = MaterialTheme.colors.secondary,
                )
            }
            item {
                Text(
                    text = exercise.exercise_name,
                    style = MaterialTheme.typography.title3,
                    textAlign = TextAlign.Center,
                    maxLines = 2,
                    modifier = Modifier.padding(horizontal = 8.dp),
                )
            }
            item {
                Text(
                    text = "Set ${set.set_number} of ${exercise.sets.size}",
                    style = MaterialTheme.typography.caption2,
                )
            }
            item {
                Stepper(
                    label = "lb",
                    value = displayWeight(set).roundToInt().toString(),
                    onIncrement = { onWeightChange(displayWeight(set) + WEIGHT_STEP) },
                    onDecrement = { onWeightChange((displayWeight(set) - WEIGHT_STEP).coerceAtLeast(0.0)) },
                )
            }
            item {
                Stepper(
                    label = "reps",
                    value = displayReps(set).toString(),
                    onIncrement = { onRepsChange(displayReps(set) + 1) },
                    onDecrement = { onRepsChange((displayReps(set) - 1).coerceAtLeast(0)) },
                )
            }
            item {
                Chip(
                    onClick = onComplete,
                    label = { Text("Done", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center) },
                    colors = ChipDefaults.primaryChipColors(),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
                )
            }
            item {
                Chip(
                    onClick = onSkip,
                    label = { Text("Skip", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center) },
                    colors = ChipDefaults.secondaryChipColors(),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
                )
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
    value: String,
    onIncrement: () -> Unit,
    onDecrement: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Button(
            onClick = onDecrement,
            colors = ButtonDefaults.secondaryButtonColors(),
            modifier = Modifier.size(ButtonDefaults.SmallButtonSize),
        ) { Text("−") }
        Text(text = "$value $label", style = MaterialTheme.typography.body1)
        Button(
            onClick = onIncrement,
            colors = ButtonDefaults.secondaryButtonColors(),
            modifier = Modifier.size(ButtonDefaults.SmallButtonSize),
        ) { Text("+") }
    }
}
