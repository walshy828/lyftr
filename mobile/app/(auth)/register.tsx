import { useState } from 'react'
import { View, Text } from 'react-native'
import { Link } from 'expo-router'
import { Screen, H1, Field, Button, Muted } from '../../src/components/ui'
import { useAuthStore } from '../../src/lib/lyftr'

export default function Register() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const register = useAuthStore((s) => s.register)
  const loading = useAuthStore((s) => s.isLoading)
  const error = useAuthStore((s) => s.error)
  const clearError = useAuthStore((s) => s.clearError)

  const localError =
    password.length > 0 && password.length < 8 ? 'Password must be at least 8 characters' : null

  const submit = async () => {
    if (localError) return
    try {
      await register(email.trim(), password)
    } catch {
      // surfaced via store
    }
  }

  return (
    <Screen className="justify-center">
      <View className="gap-8">
        <View className="gap-2">
          <H1>Create your account</H1>
          <Muted>Start tracking with Lyftr.</Muted>
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
            placeholder="At least 8 characters"
            error={localError}
          />
          {error ? <Text className="text-error-400 text-sm">{error}</Text> : null}
          <Button title="Sign up" onPress={submit} loading={loading} disabled={!!localError} />
        </View>

        <View className="flex-row justify-center gap-1.5">
          <Muted>Already have an account?</Muted>
          <Link href="/login" className="text-brand-400 font-semibold">Log in</Link>
        </View>
      </View>
    </Screen>
  )
}
