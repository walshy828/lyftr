package com.lyftr.wear

import android.Manifest
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.wear.compose.material.MaterialTheme
import com.lyftr.wear.data.WearSessionClient
import com.lyftr.wear.ui.WearApp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // The ongoing-workout notification (OngoingWorkoutService) is invisible
        // without this on Wear OS 4+ — ask once up front.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerForActivityResult(ActivityResultContracts.RequestPermission()) {}
                .launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        setContent {
            val client = remember { WearSessionClient(applicationContext) }
            DisposableEffect(client) {
                client.start()
                onDispose { client.stop() }
            }

            val session by client.session.collectAsState()
            // While a workout is live: hold the screen awake so the system
            // doesn't bounce back to the watch face mid-set, and keep the
            // ongoing indicator/service in step with the session (the
            // manifest listener covers the app-not-running case; this covers
            // the app-open case and FGS-start-from-background restrictions).
            LaunchedEffect(session != null) {
                if (session != null) {
                    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    OngoingWorkoutService.start(this@MainActivity)
                } else {
                    window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    OngoingWorkoutService.stop(this@MainActivity)
                }
            }

            MaterialTheme {
                WearApp(client)
            }
        }
    }
}
