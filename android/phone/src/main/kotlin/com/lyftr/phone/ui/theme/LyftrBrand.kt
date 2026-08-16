package com.lyftr.phone.ui.theme

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
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp

/**
 * Bent-barbell mark, geometry/colors ported from web/src/components/BarbellSVG.tsx
 * (viewBox 0..40). Drawn on a Canvas rather than as a vector asset so it can
 * pick up MaterialTheme colors if ever needed, and to keep it inline with a
 * single source of truth alongside [LyftrWordmark].
 */
@Composable
fun LyftrMark(modifier: Modifier = Modifier, size: androidx.compose.ui.unit.Dp = 32.dp) {
    Canvas(modifier = modifier.size(size)) {
        val scale = this.size.width / 40f

        // Bent bar (under load)
        val barPath = androidx.compose.ui.graphics.Path().apply {
            moveTo(4f * scale, 16f * scale)
            quadraticTo(20f * scale, 25f * scale, 36f * scale, 16f * scale)
        }
        drawPath(
            path = barPath,
            color = Color(0xFF64748B),
            style = Stroke(width = 2.6f * scale, cap = StrokeCap.Round),
        )

        // Collar dots
        drawCircle(color = LyftrColors.Collar, radius = 1f * scale, center = Offset(10.2f * scale, 18.8f * scale))
        drawCircle(color = LyftrColors.Collar, radius = 1f * scale, center = Offset(29.8f * scale, 18.8f * scale))

        // Left plates
        drawRoundRect(color = LyftrColors.PlateOuter, topLeft = Offset(3f * scale, 10f * scale), size = Size(3f * scale, 18f * scale), cornerRadius = androidx.compose.ui.geometry.CornerRadius(0.8f * scale))
        drawRoundRect(color = LyftrColors.PlateInner, topLeft = Offset(6f * scale, 8f * scale), size = Size(4f * scale, 22f * scale), cornerRadius = androidx.compose.ui.geometry.CornerRadius(1f * scale))

        // Right plates
        drawRoundRect(color = LyftrColors.PlateOuter, topLeft = Offset(34f * scale, 10f * scale), size = Size(3f * scale, 18f * scale), cornerRadius = androidx.compose.ui.geometry.CornerRadius(0.8f * scale))
        drawRoundRect(color = LyftrColors.PlateInner, topLeft = Offset(30f * scale, 8f * scale), size = Size(4f * scale, 22f * scale), cornerRadius = androidx.compose.ui.geometry.CornerRadius(1f * scale))

        // Highlights
        drawRoundRect(color = LyftrColors.PlateHighlight.copy(alpha = 0.55f), topLeft = Offset(7.2f * scale, 10.5f * scale), size = Size(1.2f * scale, 17f * scale), cornerRadius = androidx.compose.ui.geometry.CornerRadius(0.5f * scale))
        drawRoundRect(color = LyftrColors.PlateHighlight.copy(alpha = 0.55f), topLeft = Offset(31.6f * scale, 10.5f * scale), size = Size(1.2f * scale, 17f * scale), cornerRadius = androidx.compose.ui.geometry.CornerRadius(0.5f * scale))
    }
}

/** "lyftr" wordmark, lowercase and bold per web/src/components/Logo.tsx. */
@Composable
fun LyftrWordmark() {
    Text(
        "lyftr",
        style = MaterialTheme.typography.headlineSmall,
        color = MaterialTheme.colorScheme.onBackground,
    )
}

/** Mark + wordmark side by side — used atop LoginScreen and StatusScreen's top bar. */
@Composable
fun LyftrBrandHeader(markSize: androidx.compose.ui.unit.Dp = 32.dp) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        LyftrMark(size = markSize)
        Spacer(modifier = Modifier.width(8.dp))
        LyftrWordmark()
    }
}
