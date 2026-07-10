package com.lyftr.shared

/**
 * Wire contract between the phone app and the Wear OS app, carried over the
 * Wear Data Layer API (com.google.android.gms.wearable). The phone is always
 * the source of truth for what the backend has; the watch only ever proposes
 * actions and renders whatever DataItem the phone last published.
 */
object WearPaths {
    /** DataItem path: phone -> watch, full session snapshot (see [WearSession]). */
    const val SESSION = "/lyftr/session"

    /** Message path prefix: watch -> phone, one of the [WearActionType] values. */
    const val ACTION = "/lyftr/action"

    /**
     * Message path: watch -> phone, empty payload. Asks the phone to do a
     * one-shot fetch of the backend's active session and republish
     * [SESSION]. Sent when the watch app opens (or the user taps refresh) —
     * this is what wakes the otherwise-inert phone bridge, which only runs
     * its sync service while a workout is actually active.
     */
    const val REQUEST_SESSION = "/lyftr/request-session"
}

/** Keys inside the [WearPaths.SESSION] DataMap. */
object WearFields {
    const val ACTIVE = "active"
    const val SESSION_JSON = "session_json"
    const val UPDATED_AT = "updated_at"
}

enum class WearActionType {
    COMPLETE_SET,
    SKIP_SET,
    UPDATE_WEIGHT,
    UPDATE_REPS,

    /** Clears the running rest countdown entirely; exercise/set indices unused. */
    SKIP_REST,

    /** Shifts the running rest countdown by `value` seconds (±); indices unused. */
    ADJUST_REST,
}
