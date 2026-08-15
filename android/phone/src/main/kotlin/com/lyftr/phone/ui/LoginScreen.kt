package com.lyftr.phone.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.lyftr.phone.auth.LyftrApiClient
import com.lyftr.phone.auth.TokenStore
import kotlinx.coroutines.launch

private enum class Step { SERVER, CREDENTIALS }

/**
 * Two-step onboarding: validate a self-hosted server URL via GET
 * /api/v1/info (backend/controllers has a public ServerInfo handler), then
 * log in against it. There's no hardcoded host since Lyftr is self-hosted.
 *
 * Server URL and the last-used email/password are remembered
 * ([TokenStore.serverUrl]/[TokenStore.savedEmail]/[TokenStore.savedPassword]),
 * so once a server has been connected once, subsequent logins (e.g. after
 * [TokenStore.clear] on logout, or a 30-day-expired refresh token) start
 * directly on a prefilled credentials step instead of asking the user to
 * retype the server URL, email, and password every time.
 */
@Composable
fun LoginScreen(apiClient: LyftrApiClient, tokenStore: TokenStore, onLoggedIn: () -> Unit) {
    val knownServerUrl = tokenStore.serverUrl
    var step by remember { mutableStateOf(if (knownServerUrl.isNullOrBlank()) Step.SERVER else Step.CREDENTIALS) }
    var serverUrl by remember { mutableStateOf(knownServerUrl ?: "https://") }
    var email by remember { mutableStateOf(tokenStore.savedEmail ?: "") }
    var password by remember { mutableStateOf(tokenStore.savedPassword ?: "") }
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
            Text(serverUrl, style = MaterialTheme.typography.bodySmall)
            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                label = { Text("Email") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Password") },
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
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
                        if (ok) {
                            tokenStore.savedEmail = email
                            tokenStore.savedPassword = password
                            onLoggedIn()
                        } else {
                            error = "Login failed. Check your email and password."
                        }
                    }
                },
            ) {
                if (loading) CircularProgressIndicator(modifier = Modifier.padding(end = 8.dp)) else Text("Log in")
            }
            TextButton(enabled = !loading, onClick = { step = Step.SERVER; error = null }) {
                Text("Not the right server? Change it")
            }
        }
    }
}
