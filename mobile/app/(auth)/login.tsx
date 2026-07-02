import { useState } from 'react'
import { View, Text } from 'react-native'
import { Link } from 'expo-router'
import { Screen, H1, Field, Button, Muted } from '../../src/components/ui'
import { ServerConfig } from '../../src/components/ServerConfig'
import { useAuthStore } from '../../src/lib/lyftr'

export default function Login() {
  const [email, setEmail] = useState('demo@lyftr.local')
  const [password, setPassword] = useState('')
  const login = useAuthStore((s) => s.login)
  const loading = useAuthStore((s) => s.isLoading)
  const error = useAuthStore((s) => s.error)
  const clearError = useAuthStore((s) => s.clearError)

  const submit = async () => {
    try {
      await login(email.trim(), password)
      // On success the root auth gate redirects to the tabs.
    } catch {
      // error is surfaced via the store
    }
  }

  return (
    <Screen className="justify-center">
      <View className="gap-8">
        <View className="gap-2">
          <H1>Welcome back</H1>
          <Muted>Log in to your Lyftr account.</Muted>
        </View>

        <View className="gap-4">
          <Field
            label="Email"
            value={email}
            onChangeText={(t) => { clearError(); setEmail(t) }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="you@example.com"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={(t) => { clearError(); setPassword(t) }}
            secureTextEntry
            placeholder="••••••••"
          />
          {error ? <Text className="text-error-400 text-sm">{error}</Text> : null}
          <Button title="Log in" onPress={submit} loading={loading} />
        </View>

        <View className="flex-row justify-center gap-1.5">
          <Muted>No account?</Muted>
          <Link href="/register" className="text-brand-400 font-semibold">Sign up</Link>
        </View>

        <ServerConfig />
      </View>
    </Screen>
  )
}
