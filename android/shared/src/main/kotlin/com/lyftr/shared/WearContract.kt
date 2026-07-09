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
     * Temporary diagnostic path: phone -> watch, a plain MessageClient ping
     * sent alongside every DataClient session publish. Used to isolate
     * whether Data Layer messaging works at all between these two apps when
     * DataItem sync doesn't appear to be arriving. Safe to delete once the
     * sync issue is resolved.
     */
    const val PING = "/lyftr/ping"
}

enum class WearActionType {
    COMPLETE_SET,
    SKIP_SET,
    UPDATE_WEIGHT,
    UPDATE_REPS,
}
