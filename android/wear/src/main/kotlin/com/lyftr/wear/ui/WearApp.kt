package com.lyftr.wear.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import com.lyftr.shared.WearAction
import com.lyftr.shared.WearActionType
import com.lyftr.wear.data.WearSessionClient
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Locally-predicted weight/reps for the active set, rendered ahead of the phone's confirmation. */
private data class SetOverride(val exIdx: Int, val setIdx: Int, val weight: Double?, val reps: Int?)

/**
 * Top-level state machine: no active workout / active set / workout complete.
 * All mutation is optimistic-fire-and-forget over the Data Layer — the phone
 * is the source of truth and republishes the confirmed state, which flows
 * back in through [WearSessionClient.session] and re-renders this tree.
 */
@Composable
fun WearApp(client: WearSessionClient) {
    val session by client.session.collectAsState()
    val scope = rememberCoroutineScope()
    var confirmingEnd by remember { mutableStateOf(false) }
    var ratingPending by remember { mutableStateOf(false) }
    var override by remember { mutableStateOf<SetOverride?>(null) }

    val s = session
    if (s == null) {
        var checking by remember { mutableStateOf(false) }
        NoSessionScreen(
            checking = checking,
            onRefresh = {
                checking = true
                scope.launch {
                    client.requestSession()
                    // The phone's answer arrives via the session DataItem; the
                    // pause is only UI feedback so the tap visibly did something.
                    delay(2_000)
                    checking = false
                }
            },
        )
        return
    }

    if (confirmingEnd) {
        ConfirmEndWorkoutScreen(
            onConfirm = {
                confirmingEnd = false
                ratingPending = true
            },
            onCancel = { confirmingEnd = false },
        )
        return
    }

    if (ratingPending) {
        RateWorkoutScreen(
            onRate = { feeling ->
                ratingPending = false
                scope.launch { client.sendAction(WearAction(WearActionType.END_WORKOUT, feeling = feeling)) }
            },
            onSkip = {
                ratingPending = false
                scope.launch { client.sendAction(WearAction(WearActionType.END_WORKOUT)) }
            },
        )
        return
    }

    val exercise = s.exercises.getOrNull(s.current_exercise_idx)
    val set = exercise?.sets?.getOrNull(s.current_set_idx)
    // Computed here (not a phone-supplied flag) since every WearSet already
    // carries `completed` for rendering — no need to duplicate this as a
    // separate field that could drift out of sync with the per-set values
    // it's derived from.
    val allComplete = s.exercises.isNotEmpty() &&
        s.exercises.all { it.sets.isNotEmpty() && it.sets.all { set -> set.completed } }

    if (exercise == null || set == null || allComplete) {
        WorkoutCompleteScreen(
            workoutName = s.name,
            onFinish = { ratingPending = true },
        )
        return
    }

    val exIdx = s.current_exercise_idx
    val setIdx = s.current_set_idx

    // The override only ever predicts the currently active set — once the
    // watch moves on (complete/skip advances the index), drop it and let
    // whatever the phone has confirmed for the new set render as-is.
    LaunchedEffect(exIdx, setIdx) { override = null }

    val displaySet = override?.let { o ->
        if (o.exIdx == exIdx && o.setIdx == setIdx) {
            set.copy(actual_weight = o.weight ?: set.actual_weight, actual_reps = o.reps ?: set.actual_reps)
        } else null
    } ?: set

    ActiveSetScreen(
        session = s,
        exercise = exercise,
        set = displaySet,
        onComplete = {
            scope.launch { client.sendAction(WearAction(WearActionType.COMPLETE_SET, exIdx, setIdx)) }
        },
        onSkip = {
            scope.launch { client.sendAction(WearAction(WearActionType.SKIP_SET, exIdx, setIdx)) }
        },
        onWeightChange = { newWeight ->
            // Update the on-screen value immediately — the network round trip
            // (watch -> phone -> backend -> phone -> watch) shouldn't gate what
            // the user sees after a tap, only when it's finally confirmed.
            override = SetOverride(exIdx, setIdx, newWeight, override?.reps)
            scope.launch { client.sendAction(WearAction(WearActionType.UPDATE_WEIGHT, exIdx, setIdx, newWeight)) }
        },
        onRepsChange = { newReps ->
            override = SetOverride(exIdx, setIdx, override?.weight, newReps)
            scope.launch { client.sendAction(WearAction(WearActionType.UPDATE_REPS, exIdx, setIdx, newReps.toDouble())) }
        },
        onSkipRest = {
            scope.launch { client.sendAction(WearAction(WearActionType.SKIP_REST, exIdx, setIdx)) }
        },
        onAdjustRest = { deltaSec ->
            scope.launch { client.sendAction(WearAction(WearActionType.ADJUST_REST, exIdx, setIdx, deltaSec.toDouble())) }
        },
        onEndWorkout = { confirmingEnd = true },
    )
}
