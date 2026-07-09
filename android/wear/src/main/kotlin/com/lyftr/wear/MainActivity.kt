package com.lyftr.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.wear.compose.material.MaterialTheme
import com.lyftr.wear.data.WearSessionClient
import com.lyftr.wear.ui.WearApp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val client = remember { WearSessionClient(applicationContext) }
            DisposableEffect(client) {
                client.start()
                onDispose { client.stop() }
            }
            MaterialTheme {
                WearApp(client)
            }
        }
    }
}
