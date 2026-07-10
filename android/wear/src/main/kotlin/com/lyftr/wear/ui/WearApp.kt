package com.lyftr.wear.ui

import androidx.compose.runtime.Composable
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

    val exercise = s.exercises.getOrNull(s.current_exercise_idx)
    val set = exercise?.sets?.getOrNull(s.current_set_idx)

    if (exercise == null || set == null) {
        WorkoutCompleteScreen(workoutName = s.name)
        return
    }

    val exIdx = s.current_exercise_idx
    val setIdx = s.current_set_idx

    ActiveSetScreen(
        session = s,
        exercise = exercise,
        set = set,
        onComplete = {
            scope.launch { client.sendAction(WearAction(WearActionType.COMPLETE_SET, exIdx, setIdx)) }
        },
        onSkip = {
            scope.launch { client.sendAction(WearAction(WearActionType.SKIP_SET, exIdx, setIdx)) }
        },
        onWeightChange = { newWeight ->
            scope.launch { client.sendAction(WearAction(WearActionType.UPDATE_WEIGHT, exIdx, setIdx, newWeight)) }
        },
        onRepsChange = { newReps ->
            scope.launch { client.sendAction(WearAction(WearActionType.UPDATE_REPS, exIdx, setIdx, newReps.toDouble())) }
        },
        onSkipRest = {
            scope.launch { client.sendAction(WearAction(WearActionType.SKIP_REST, exIdx, setIdx)) }
        },
        onAdjustRest = { deltaSec ->
            scope.launch { client.sendAction(WearAction(WearActionType.ADJUST_REST, exIdx, setIdx, deltaSec.toDouble())) }
        },
    )
}
