package com.baseline.phone.ui.theme

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp

/**
 * Baseline shield mark (private, self-hosted) carrying a vitals trace; geometry and
 * colors match web/src/components/LogoMark.tsx (viewBox 0..32).
 */
@Composable
fun BaselineMark(modifier: Modifier = Modifier, size: androidx.compose.ui.unit.Dp = 32.dp) {
    Canvas(modifier = modifier.size(size)) {
        val k = this.size.width / 32f

        val shield = Path().apply {
            moveTo(16f * k, 3f * k)
            lineTo(27f * k, 6.8f * k)
            lineTo(27f * k, 15f * k)
            cubicTo(27f * k, 21.5f * k, 22.5f * k, 26f * k, 16f * k, 29f * k)
            cubicTo(9.5f * k, 26f * k, 5f * k, 21.5f * k, 5f * k, 15f * k)
            lineTo(5f * k, 6.8f * k)
            close()
        }
        drawPath(
            path = shield,
            brush = Brush.linearGradient(
                colors = listOf(Color(0xFF13C2EC), Color(0xFF4FE3A1)),
                start = Offset(5f * k, 3f * k),
                end = Offset(27f * k, 29f * k),
            ),
        )

        val trace = Path().apply {
            moveTo(9f * k, 15.5f * k)
            lineTo(13f * k, 15.5f * k)
            lineTo(15f * k, 11f * k)
            lineTo(17.5f * k, 20f * k)
            lineTo(19.5f * k, 15.5f * k)
            lineTo(23f * k, 15.5f * k)
        }
        drawPath(
            path = trace,
            color = Color(0xFF0A0B0F),
            style = Stroke(width = 2f * k, cap = StrokeCap.Round, join = StrokeJoin.Round),
        )
    }
}

/** "baseline" wordmark, lowercase and bold per web/src/components/Logo.tsx. */
@Composable
fun BaselineWordmark() {
    Text(
        "baseline",
        style = MaterialTheme.typography.headlineSmall,
        color = MaterialTheme.colorScheme.onBackground,
    )
}

/** Mark + wordmark side by side — used atop LoginScreen and StatusScreen's top bar. */
@Composable
fun BaselineBrandHeader(markSize: androidx.compose.ui.unit.Dp = 32.dp) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        BaselineMark(size = markSize)
        Spacer(modifier = Modifier.width(8.dp))
        BaselineWordmark()
    }
}
