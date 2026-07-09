package com.lyftr.shared

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Mirrors the subset of the web app's `ActiveSession` (web/src/types.ts) that
 * the watch needs to render — no notes/target fields the watch doesn't show,
 * to keep the Data Layer payload small. Field names intentionally match the
 * backend's `active-session` JSON blob (snake_case) so the phone can decode
 * the server response directly into this type with no field mapping.
 */
@Serializable
data class WearSet(
    val set_number: Int,
    val target_reps: Int,
    val target_weight: Double,
    val actual_reps: Int,
    val actual_weight: Double,
    val completed: Boolean,
)

@Serializable
data class WearExercise(
    val exercise_id: Long,
    val exercise_name: String,
    val rest_seconds: Int? = null,
    val sets: List<WearSet>,
)

@Serializable
data class WearSession(
    val name: String,
    val started_at: String,
    val exercises: List<WearExercise>,
    val current_exercise_idx: Int = 0,
    val current_set_idx: Int = 0,
    val rest_ends_at: Long? = null,
    val rest_duration_sec: Int? = null,
) {
    fun toJson(): String = Json.encodeToString(serializer(), this)

    companion object {
        fun fromJson(json: String): WearSession = Json.decodeFromString(serializer(), json)
    }
}

/** Sent watch -> phone as a MessageClient payload on [WearPaths.ACTION]. */
@Serializable
data class WearAction(
    val type: WearActionType,
    val exercise_idx: Int,
    val set_idx: Int,
    /** Only set for UPDATE_WEIGHT / UPDATE_REPS. */
    val value: Double? = null,
) {
    fun toJson(): String = Json.encodeToString(serializer(), this)

    companion object {
        fun fromJson(json: String): WearAction = Json.decodeFromString(serializer(), json)
    }
}
