package com.lyftr.wear.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import kotlinx.coroutines.delay
import java.time.Instant

/**
 * Ticking "time since the workout started" derived locally from the session's
 * absolute started_at (ISO-8601 from the web app) — same approach as the rest
 * countdown: the phone never needs to send timer ticks, only anchor stamps.
 */
@Composable
fun rememberWorkoutElapsed(startedAt: String): State<String> {
    val startMs = remember(startedAt) {
        runCatching { Instant.parse(startedAt).toEpochMilli() }.getOrDefault(0L)
    }
    return produceState(initialValue = formatElapsed(startMs), startMs) {
        while (true) {
            value = formatElapsed(startMs)
            delay(1_000)
        }
    }
}

private fun formatElapsed(startMs: Long): String {
    if (startMs <= 0) return ""
    val totalSec = ((System.currentTimeMillis() - startMs) / 1000).coerceAtLeast(0)
    val h = totalSec / 3600
    val m = (totalSec % 3600) / 60
    val s = totalSec % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}
