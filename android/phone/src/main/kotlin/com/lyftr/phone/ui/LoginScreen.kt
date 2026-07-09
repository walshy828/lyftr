package com.lyftr.phone.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.lyftr.phone.auth.LyftrApiClient
import com.lyftr.phone.auth.TokenStore
import kotlinx.coroutines.launch

private enum class Step { SERVER, CREDENTIALS }

/**
 * Two-step onboarding: validate a self-hosted server URL via GET
 * /api/v1/info (backend/controllers has a public ServerInfo handler), then
 * log in against it. There's no hardcoded host since Lyftr is self-hosted.
 */
@Composable
fun LoginScreen(apiClient: LyftrApiClient, tokenStore: TokenStore, onLoggedIn: () -> Unit) {
    var step by remember { mutableStateOf(Step.SERVER) }
    var serverUrl by remember { mutableStateOf(tokenStore.serverUrl ?: "https://") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier.fillMaxWidth().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Connect to your Lyftr server")

        if (step == Step.SERVER) {
            OutlinedTextField(
                value = serverUrl,
                onValueChange = { serverUrl = it },
                label = { Text("Server URL") },
                modifier = Modifier.fillMaxWidth(),
            )
            if (error != null) Text(error!!)
            Button(
                enabled = !loading && serverUrl.isNotBlank(),
                onClick = {
                    loading = true
                    error = null
                    scope.launch {
                        val ok = apiClient.checkServer(serverUrl)
                        loading = false
                        if (ok) {
                            tokenStore.serverUrl = serverUrl
                            step = Step.CREDENTIALS
                        } else {
                            error = "Couldn't reach that server. Check the URL and try again."
                        }
                    }
                },
            ) {
                if (loading) CircularProgressIndicator(modifier = Modifier.padding(end = 8.dp)) else Text("Next")
            }
        } else {
            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                label = { Text("Email") },
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Password") },
                modifier = Modifier.fillMaxWidth(),
            )
            if (error != null) Text(error!!)
            Button(
                enabled = !loading && email.isNotBlank() && password.isNotBlank(),
                onClick = {
                    loading = true
                    error = null
                    scope.launch {
                        val ok = apiClient.login(email, password)
                        loading = false
                        if (ok) onLoggedIn() else error = "Login failed. Check your email and password."
                    }
                },
            ) {
                if (loading) CircularProgressIndicator(modifier = Modifier.padding(end = 8.dp)) else Text("Log in")
            }
        }
    }
}
