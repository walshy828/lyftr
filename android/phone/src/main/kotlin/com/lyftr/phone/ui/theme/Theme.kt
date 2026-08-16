package com.lyftr.phone.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val LyftrDarkColorScheme = darkColorScheme(
    primary = LyftrColors.Brand300,
    onPrimary = LyftrColors.SurfaceBaseDark,
    secondary = LyftrColors.Violet400,
    onSecondary = LyftrColors.SurfaceBaseDark,
    background = LyftrColors.SurfaceBaseDark,
    onBackground = LyftrColors.TxPrimaryDark,
    surface = LyftrColors.SurfaceRaisedDark,
    onSurface = LyftrColors.TxPrimaryDark,
    surfaceVariant = LyftrColors.SurfaceRaisedDark,
    outline = LyftrColors.SurfaceBorderDark,
    error = LyftrColors.Error500,
    onError = LyftrColors.TxPrimaryDark,
)

private val LyftrLightColorScheme = lightColorScheme(
    primary = LyftrColors.Brand600,
    onPrimary = LyftrColors.SurfaceBaseLight,
    secondary = LyftrColors.Violet600,
    onSecondary = LyftrColors.SurfaceBaseLight,
    background = LyftrColors.SurfaceBaseLight,
    onBackground = LyftrColors.TxPrimaryLight,
    surface = LyftrColors.SurfaceRaisedLight,
    onSurface = LyftrColors.TxPrimaryLight,
    surfaceVariant = LyftrColors.SurfaceBaseLight,
    outline = LyftrColors.SurfaceBorderLight,
    error = LyftrColors.Error600,
    onError = LyftrColors.SurfaceBaseLight,
)

/** App-wide brand theme — cyan/violet accents on navy dark / off-white light, matching web/tailwind.config.ts. */
@Composable
fun LyftrTheme(content: @Composable () -> Unit) {
    val colorScheme = if (isSystemInDarkTheme()) LyftrDarkColorScheme else LyftrLightColorScheme
    MaterialTheme(
        colorScheme = colorScheme,
        typography = LyftrTypography,
        content = content,
    )
}
