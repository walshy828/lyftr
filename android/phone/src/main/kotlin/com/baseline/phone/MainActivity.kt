package com.baseline.phone

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import com.baseline.phone.ui.BaselinePhoneApp
import com.baseline.phone.ui.theme.BaselineTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            BaselineTheme {
                Surface(color = MaterialTheme.colorScheme.background) {
                    BaselinePhoneApp()
                }
            }
        }
    }
}
