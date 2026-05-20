import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import en from './locales/en.json'

// Add a language: drop a `<code>.json` next to en.json, import it, and add an
// entry here. Crowd-sourced translations can later be wired up via Weblate,
// which expects this monolingual-JSON-with-English-base layout.
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
] as const

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code']

const STORAGE_KEY = 'lyftr_lang'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
    },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES.map(l => l.code),
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: STORAGE_KEY,
      caches: ['localStorage'],
    },
  })

// Keep <html lang> in sync so screen readers and the browser pick the right
// hyphenation/spellcheck rules.
const applyHtmlLang = (lng: string) => {
  document.documentElement.lang = lng
}
applyHtmlLang(i18n.resolvedLanguage ?? 'en')
i18n.on('languageChanged', applyHtmlLang)

export default i18n
