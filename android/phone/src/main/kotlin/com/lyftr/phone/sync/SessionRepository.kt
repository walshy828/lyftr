package com.lyftr.phone.sync

import com.lyftr.phone.auth.CreateSetReq
import com.lyftr.phone.auth.CreateWorkoutExerciseReq
import com.lyftr.phone.auth.CreateWorkoutRequest
import com.lyftr.shared.WearAction
import com.lyftr.shared.WearActionType
import com.lyftr.shared.WearExercise
import com.lyftr.shared.WearSession
import com.lyftr.shared.WearSet
import java.time.Instant
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/**
 * Holds the phone's in-memory copy of the active-session JSON blob (the same
 * opaque `data` string the web app now PUTs to backend/controllers/active_session.go)
 * as a generic [JsonObject] tree rather than a fixed data class. This is
 * deliberate: the web app's `ActiveSession` (web/src/types.ts) may carry
 * fields the phone doesn't render (exercise metadata, notes, program_id,
 * etc.), and round-tripping through a narrower Kotlin type would silently
 * drop them on the next PUT. Watch-originated edits are applied as targeted
 * mutations to specific leaves of this tree, leaving everything else intact.
 */
object SessionRepository {
    private val json = Json { ignoreUnknownKeys = true }

    private val _raw = MutableStateFlow<JsonObject?>(null)
    val raw: StateFlow<JsonObject?> = _raw

    fun setFromServerJson(sessionJson: String?) {
        _raw.value = sessionJson?.let { json.parseToJsonElement(it).jsonObject }
    }

    fun rawJsonString(): String? = _raw.value?.toString()

    fun clear() {
        _raw.value = null
    }

    /** Projects the full blob down to what the watch actually renders. */
    fun toWearSession(): WearSession? {
        val obj = _raw.value ?: return null
        val exercises = obj["exercises"]?.jsonArray ?: JsonArray(emptyList())
        return WearSession(
            name = obj["name"]?.jsonPrimitive?.content ?: "",
            started_at = obj["started_at"]?.jsonPrimitive?.content ?: "",
            exercises = exercises.map { it.jsonObject.toWearExercise() },
            current_exercise_idx = obj["current_exercise_idx"]?.jsonPrimitive?.intOrNull ?: 0,
            current_set_idx = obj["current_set_idx"]?.jsonPrimitive?.intOrNull ?: 0,
            rest_ends_at = obj["rest_ends_at"]?.jsonPrimitive?.longOrNull,
            rest_duration_sec = obj["rest_duration_sec"]?.jsonPrimitive?.intOrNull,
        )
    }

    private fun JsonObject.toWearExercise(): WearExercise {
        val sets = this["sets"]?.jsonArray ?: JsonArray(emptyList())
        return WearExercise(
            exercise_id = this["exercise_id"]?.jsonPrimitive?.longOrNull ?: 0,
            exercise_name = this["exercise"]?.jsonObject?.get("name")?.jsonPrimitive?.content ?: "",
            rest_seconds = this["rest_seconds"]?.jsonPrimitive?.intOrNull,
            sets = sets.map { it.jsonObject.toWearSet() },
        )
    }

    private fun JsonObject.toWearSet() = WearSet(
        set_number = this["set_number"]?.jsonPrimitive?.intOrNull ?: 0,
        target_reps = this["target_reps"]?.jsonPrimitive?.intOrNull ?: 0,
        target_weight = this["target_weight"]?.jsonPrimitive?.doubleOrNull ?: 0.0,
        actual_reps = this["actual_reps"]?.jsonPrimitive?.intOrNull ?: 0,
        actual_weight = this["actual_weight"]?.jsonPrimitive?.doubleOrNull ?: 0.0,
        completed = this["completed"]?.jsonPrimitive?.booleanOrNull ?: false,
    )

    /**
     * Applies a watch-originated action to the tree in place (optimistic —
     * the caller pushes the result to the backend and republishes to the
     * watch). Returns false if the action's indices no longer match the
     * current session shape (e.g. a set was deleted on web mid-workout).
     *
     * Note: unlike the web app's updateSet (web/src/stores/workoutSession.ts),
     * this does not propagate a weight change forward onto later sets — that
     * pyramid-preserving UX nuance was judged out of scope for the watch's
     * core-loop v1.
     */
    fun applyAction(action: WearAction): Boolean {
        val obj = _raw.value ?: return false

        // Rest-timer actions mutate session-level fields only — handled
        // before the per-set index validation below, which doesn't apply.
        when (action.type) {
            WearActionType.SKIP_REST -> {
                _raw.value = obj
                    .with("rest_ends_at", JsonNull)
                    .with("rest_duration_sec", JsonNull)
                return true
            }
            WearActionType.ADJUST_REST -> {
                val endsAt = obj["rest_ends_at"]?.jsonPrimitive?.longOrNull ?: return false
                val deltaSec = (action.value ?: 0.0).toInt()
                // Same clamps as the web's adjustRest (web/src/stores/workoutSession.ts):
                // the end stamp never moves into the past, duration floors at 1s.
                val newEndsAt = (endsAt + deltaSec * 1000L).coerceAtLeast(System.currentTimeMillis())
                val newDuration = ((obj["rest_duration_sec"]?.jsonPrimitive?.intOrNull ?: 0) + deltaSec).coerceAtLeast(1)
                _raw.value = obj
                    .with("rest_ends_at", JsonPrimitive(newEndsAt))
                    .with("rest_duration_sec", JsonPrimitive(newDuration))
                return true
            }
            // Handled directly by WearListenerService (POST /workouts + clear),
            // never mutates this tree; reachable here only defensively.
            WearActionType.END_WORKOUT -> return false
            else -> {}
        }

        val exercises = obj["exercises"]?.jsonArray ?: return false
        val exIdx = action.exercise_idx ?: return false
        if (exIdx !in exercises.indices) return false
        val exercise = exercises[exIdx].jsonObject
        val sets = exercise["sets"]?.jsonArray ?: return false
        val setIdx = action.set_idx ?: return false
        if (setIdx !in sets.indices) return false
        val set = sets[setIdx].jsonObject

        val updatedSet = when (action.type) {
            WearActionType.COMPLETE_SET -> set.with("completed", JsonPrimitive(true))
            WearActionType.SKIP_SET -> set.with("completed", JsonPrimitive(false))
            WearActionType.UPDATE_WEIGHT -> set.with("actual_weight", JsonPrimitive(action.value ?: 0.0))
            WearActionType.UPDATE_REPS -> set.with("actual_reps", JsonPrimitive((action.value ?: 0.0).toInt()))
            // Rest/session-level actions returned above; unreachable.
            WearActionType.SKIP_REST, WearActionType.ADJUST_REST, WearActionType.END_WORKOUT -> return false
        }
        val updatedSets = JsonArray(sets.mapIndexed { i, el -> if (i == setIdx) updatedSet else el })
        val updatedExercise = exercise.with("sets", updatedSets)
        val updatedExercises = JsonArray(exercises.mapIndexed { i, el -> if (i == exIdx) updatedExercise else el })

        // Auto-advance to the next incomplete set on complete/skip, mirroring
        // web/src/pages/GymModeWorkout.tsx's handleCompleteSetGym.
        val (nextEx, nextSet) = when (action.type) {
            WearActionType.COMPLETE_SET, WearActionType.SKIP_SET -> nextIncompleteSet(updatedExercises, exIdx, setIdx)
            else -> exIdx to setIdx
        }

        var updated = obj
            .with("exercises", updatedExercises)
            .with("current_exercise_idx", JsonPrimitive(nextEx))
            .with("current_set_idx", JsonPrimitive(nextSet))

        // Completing a set starts the exercise's rest countdown (again
        // mirroring handleCompleteSetGym) so the watch shows "time until the
        // next set" even when the completion happened on the watch itself —
        // the web only starts rest for its own completions. Skips move on
        // without resting.
        if (action.type == WearActionType.COMPLETE_SET) {
            val restSec = exercise["rest_seconds"]?.jsonPrimitive?.intOrNull ?: 0
            updated = if (restSec > 0) {
                updated
                    .with("rest_ends_at", JsonPrimitive(System.currentTimeMillis() + restSec * 1000L))
                    .with("rest_duration_sec", JsonPrimitive(restSec))
            } else {
                updated
                    .with("rest_ends_at", JsonNull)
                    .with("rest_duration_sec", JsonNull)
            }
        }

        _raw.value = updated
        return true
    }

    /** True once every set in every exercise is marked completed. */
    fun isWorkoutComplete(): Boolean {
        val obj = _raw.value ?: return false
        val exercises = obj["exercises"]?.jsonArray ?: return false
        if (exercises.isEmpty()) return false
        return exercises.all { exEl ->
            val sets = exEl.jsonObject["sets"]?.jsonArray ?: return@all false
            sets.isNotEmpty() && sets.all { it.jsonObject["completed"]?.jsonPrimitive?.booleanOrNull == true }
        }
    }

    /**
     * Projects the current tree into the shape backend/controllers/workouts.go's
     * CreateWorkout expects, mirroring web's buildPayload() (workoutSession.ts):
     * every set is included regardless of `completed`, falling back to target
     * reps/weight when no actual value was ever recorded — this is what lets an
     * early-ended workout still log its unfinished sets at their planned values.
     */
    fun toCreateWorkoutRequest(feeling: Int = 0): CreateWorkoutRequest? {
        val obj = _raw.value ?: return null
        val startedAt = obj["started_at"]?.jsonPrimitive?.content ?: return null
        val durationSec = ((System.currentTimeMillis() - Instant.parse(startedAt).toEpochMilli()) / 1000)
            .toInt().coerceAtLeast(0)
        val exercises = obj["exercises"]?.jsonArray ?: JsonArray(emptyList())
        return CreateWorkoutRequest(
            name = obj["name"]?.jsonPrimitive?.content ?: "",
            duration = durationSec,
            started_at = startedAt,
            program_id = obj["program_id"]?.jsonPrimitive?.longOrNull,
            feeling = feeling,
            exercises = exercises.mapIndexed { i, exEl ->
                val ex = exEl.jsonObject
                val sets = ex["sets"]?.jsonArray ?: JsonArray(emptyList())
                CreateWorkoutExerciseReq(
                    exercise_id = ex["exercise_id"]?.jsonPrimitive?.longOrNull ?: 0,
                    order_index = i,
                    rest_seconds = ex["rest_seconds"]?.jsonPrimitive?.intOrNull ?: 0,
                    sets = sets.mapIndexed { si, setEl ->
                        val set = setEl.jsonObject
                        val actualReps = set["actual_reps"]?.jsonPrimitive?.intOrNull ?: 0
                        val actualWeight = set["actual_weight"]?.jsonPrimitive?.doubleOrNull ?: 0.0
                        CreateSetReq(
                            set_number = si + 1,
                            reps = if (actualReps > 0) actualReps else set["target_reps"]?.jsonPrimitive?.intOrNull ?: 0,
                            weight = if (actualWeight > 0) actualWeight else set["target_weight"]?.jsonPrimitive?.doubleOrNull ?: 0.0,
                            completed = set["completed"]?.jsonPrimitive?.booleanOrNull == true,
                        )
                    },
                )
            },
        )
    }

    private fun nextIncompleteSet(exercises: JsonArray, fromEx: Int, fromSet: Int): Pair<Int, Int> {
        for (exIdx in fromEx until exercises.size) {
            val sets = exercises[exIdx].jsonObject["sets"]?.jsonArray ?: continue
            val startSet = if (exIdx == fromEx) fromSet + 1 else 0
            for (setIdx in startSet until sets.size) {
                val completed = sets[setIdx].jsonObject["completed"]?.jsonPrimitive?.booleanOrNull ?: false
                if (!completed) return exIdx to setIdx
            }
        }
        return fromEx to fromSet
    }

    private fun JsonObject.with(key: String, value: kotlinx.serialization.json.JsonElement): JsonObject =
        JsonObject(toMutableMap().apply { put(key, value) })
}
