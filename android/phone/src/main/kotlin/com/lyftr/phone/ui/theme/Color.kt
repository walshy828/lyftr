package com.lyftr.phone.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Ported from web/tailwind.config.ts — keep both in sync if the web brand
 * palette changes.
 */
object LyftrColors {
    // Brand — electric cyan
    val Brand50 = Color(0xFFE0F9FF)
    val Brand200 = Color(0xFF7AE7FD)
    val Brand300 = Color(0xFF38D8FB)
    val Brand500 = Color(0xFF00B8D9)
    val Brand600 = Color(0xFF0099B8)
    val Brand700 = Color(0xFF007A96)
    val Brand900 = Color(0xFF003D4D)

    // Secondary accent — violet
    val Violet400 = Color(0xFFA78BFA)
    val Violet500 = Color(0xFF8B5CF6)
    val Violet600 = Color(0xFF7C3AED)

    // Semantic
    val Success500 = Color(0xFF22C55E)
    val Warning400 = Color(0xFFFACC15)
    val Warning500 = Color(0xFFEAB308)
    val Error500 = Color(0xFFEF4444)
    val Error600 = Color(0xFFDC2626)

    // Dark-mode navy surfaces (not pure black — see index.css --surface-*)
    val SurfaceBaseDark = Color(0xFF070D1A)
    val SurfaceRaisedDark = Color(0xFF0D1629)
    val SurfaceBorderDark = Color(0xFF1C2F50)

    // Light-mode surfaces
    val SurfaceBaseLight = Color(0xFFF8FAFC)
    val SurfaceRaisedLight = Color(0xFFFFFFFF)
    val SurfaceBorderLight = Color(0xFFE2E8F0)

    // Text
    val TxPrimaryDark = Color(0xFFF1F5F9)
    val TxPrimaryLight = Color(0xFF0F172A)

    // Barbell mark plate colors (BarbellSVG.tsx)
    val PlateOuter = Color(0xFF0891B2)
    val PlateInner = Color(0xFF00B8D9)
    val PlateHighlight = Color(0xFF7EEEFF)
    val Collar = Color(0xFF475569)
    val LogoPlateNavy = Color(0xFF0D1629)
}
