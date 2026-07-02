import { useState } from 'react'
import { View, Text, Pressable } from 'react-native'
import { Field, Button, Muted } from './ui'
import { useServerStore } from '../lib/lyftr'
import { testServerConnection, normalizeServerUrl } from '@lyftr/shared'

// Server picker for the auth screens. On mobile there is no same-origin default, so
// a self-hosted user must point the app at their backend BEFORE logging in — this
// gives them that on the login/register screens (collapsed by default).
export function ServerConfig() {
  const serverUrl = useServerStore((s) => s.serverUrl)
  const setServerUrl = useServerStore((s) => s.setServerUrl)
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(serverUrl)
  const [msg, setMsg] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [testing, setTesting] = useState(false)

  const save = async () => {
    setTesting(true)
    setMsg(null)
    const base = normalizeServerUrl(url)
    if (url.trim() && !base) {
      setOk(false)
      setMsg('Include the full URL with http:// or https://')
      setTesting(false)
      return
    }
    const result = await testServerConnection(base)
    if (result.ok) {
      await setServerUrl(url)
      setOk(true)
      setMsg(`Connected to ${result.info.name} v${result.info.version}`)
    } else {
      setOk(false)
      setMsg(result.message)
    }
    setTesting(false)
  }

  return (
    <View className="gap-2">
      <Pressable onPress={() => setOpen((o) => !o)} className="flex-row justify-center">
        <Muted className="text-xs">
          Server: {serverUrl || 'not set'} · {open ? 'Hide' : 'Change'}
        </Muted>
      </Pressable>
      {open ? (
        <View className="gap-2 mt-1">
          <Field
            value={url}
            onChangeText={(t) => { setMsg(null); setUrl(t) }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://your-server:3000"
          />
          {msg ? (
            <Text className={`text-xs ${ok ? 'text-success-400' : 'text-error-400'}`}>{msg}</Text>
          ) : null}
          <Button title="Test & save" variant="secondary" onPress={save} loading={testing} />
        </View>
      ) : null}
    </View>
  )
}
