import * as SecureStore from 'expo-secure-store'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { StorageAdapter, STORAGE_KEYS } from '@lyftr/shared'

// The mobile StorageAdapter: secrets (tokens + cached user) live in the Keychain via
// SecureStore; non-secret prefs (server URL, layout, rest timer) live in AsyncStorage.
const SECURE = new Set<string>([STORAGE_KEYS.access, STORAGE_KEYS.refresh, STORAGE_KEYS.user])

export const storage: StorageAdapter = {
  get: (key) => (SECURE.has(key) ? SecureStore.getItemAsync(key) : AsyncStorage.getItem(key)),
  set: async (key, value) => {
    if (SECURE.has(key)) await SecureStore.setItemAsync(key, value)
    else await AsyncStorage.setItem(key, value)
  },
  remove: async (key) => {
    if (SECURE.has(key)) await SecureStore.deleteItemAsync(key)
    else await AsyncStorage.removeItem(key)
  },
}
