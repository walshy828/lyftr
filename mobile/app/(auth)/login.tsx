import { useState } from 'react'
import { Text, View, Linking } from 'react-native'
import { Link } from 'expo-router'
import { AuthScaffold } from '../../src/components/AuthScaffold'
import { IconInput, GradientButton, SecondaryButton, AuthDivider, AuthError, ServerRow, Footer } from '../../src/components/authui'
import { useAuthStore } from '../../src/lib/lyftr'
import { useTheme } from '../../src/theme/useTheme'

// Public hosted demo (Fly) — the "Try demo account" button opens it in the browser.
const DEMO_URL = 'https://lyftr-demo.fly.dev'

// Same intent as the web's <input type=email required>: a lightweight shape check,
// not RFC validation — the server has the final say.
const EMAIL_RE = /^\S+@\S+\.\S+$/

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const login = useAuthStore((s) => s.login)
  const loading = useAuthStore((s) => s.isLoading)
  const error = useAuthStore((s) => s.error)
  const clearError = useAuthStore((s) => s.clearError)
  const { accent, colors, brand } = useTheme()

  // RN has no HTML `required`, so gate the button instead: both fields filled and the
  // email looks like an email (mirrors the web form's native validation).
  const emailOk = EMAIL_RE.test(email.trim())
  const canSubmit = emailOk && password.length > 0

  const submit = async () => {
    if (!canSubmit) return
    try { await login(email.trim(), password) } catch {}
  }
  const demo = () => {
    Linking.openURL(DEMO_URL).catch(() => {})
  }

  return (
    <AuthScaffold heading="Welcome back" subtitle="Sign in to continue training.">
      <ServerRow />
      <IconInput
        label="Email"
        icon="mail"
        value={email}
        onChangeText={(t) => { clearError(); setEmail(t) }}
        keyboardType="email-address"
        placeholder="you@example.com"
      />
      {email.length > 0 && !emailOk ? (
        <Text style={{ marginTop: 7, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: brand.error }}>
          Enter a valid email address
        </Text>
      ) : null}
      <IconInput
        label="Password"
        icon="lock"
        password
        value={password}
        onChangeText={(t) => { clearError(); setPassword(t) }}
        placeholder="••••••••"
      />
      {error ? <AuthError message={error} /> : null}
      <GradientButton title="Sign in" onPress={submit} loading={loading} disabled={!canSubmit} />
      <AuthDivider />
      <SecondaryButton title="Try demo account" hint="no sign-up" onPress={demo} />
      <Footer>
        <View style={{ flexDirection: 'row', gap: 5 }}>
          <Text style={{ color: colors.txSecondary, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14 }}>New here?</Text>
          <Link href="/register" style={{ color: accent, fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 14 }}>
            Create account
          </Link>
        </View>
      </Footer>
    </AuthScaffold>
  )
}
