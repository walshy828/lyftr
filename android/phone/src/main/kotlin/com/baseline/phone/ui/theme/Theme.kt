package com.baseline.phone.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val BaselineDarkColorScheme = darkColorScheme(
    primary = BaselineColors.Brand300,
    onPrimary = BaselineColors.SurfaceBaseDark,
    secondary = BaselineColors.Violet400,
    onSecondary = BaselineColors.SurfaceBaseDark,
    background = BaselineColors.SurfaceBaseDark,
    onBackground = BaselineColors.TxPrimaryDark,
    surface = BaselineColors.SurfaceRaisedDark,
    onSurface = BaselineColors.TxPrimaryDark,
    surfaceVariant = BaselineColors.SurfaceRaisedDark,
    outline = BaselineColors.SurfaceBorderDark,
    error = BaselineColors.Error500,
    onError = BaselineColors.TxPrimaryDark,
)

private val BaselineLightColorScheme = lightColorScheme(
    primary = BaselineColors.Brand600,
    onPrimary = BaselineColors.SurfaceBaseLight,
    secondary = BaselineColors.Violet600,
    onSecondary = BaselineColors.SurfaceBaseLight,
    background = BaselineColors.SurfaceBaseLight,
    onBackground = BaselineColors.TxPrimaryLight,
    surface = BaselineColors.SurfaceRaisedLight,
    onSurface = BaselineColors.TxPrimaryLight,
    surfaceVariant = BaselineColors.SurfaceBaseLight,
    outline = BaselineColors.SurfaceBorderLight,
    error = BaselineColors.Error600,
    onError = BaselineColors.SurfaceBaseLight,
)

/** App-wide brand theme — cyan/violet accents on navy dark / off-white light, matching web/tailwind.config.ts. */
@Composable
fun BaselineTheme(content: @Composable () -> Unit) {
    val colorScheme = if (isSystemInDarkTheme()) BaselineDarkColorScheme else BaselineLightColorScheme
    MaterialTheme(
        colorScheme = colorScheme,
        typography = BaselineTypography,
        content = content,
    )
}
