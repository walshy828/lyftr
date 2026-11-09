import type { Config } from 'tailwindcss'

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans:    ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono:    ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        // CSS-variable-backed surface tokens — light/dark handled in CSS
        surface: {
          base:    'var(--surface-base)',
          raised:  'var(--surface-raised)',
          overlay: 'var(--surface-overlay)',
          border:  'var(--surface-border)',
          muted:   'var(--surface-muted)',
        },
        tx: {
          primary:   'var(--tx-primary)',
          secondary: 'var(--tx-secondary)',
          muted:     'var(--tx-muted)',
          faint:     'var(--tx-faint)',
          inverse:   'var(--tx-inverse)',
        },
        // Brand — "signal" cyan. Baseline's heritage hue, freshened toward the
        // TraceApps family (mint/cyan on near-black).
        brand: {
          50:  '#e6fbff',
          100: '#bff3ff',
          200: '#8aeaff',
          300: '#55e1ff',
          400: '#2ad6fa',
          500: '#13c2ec',
          600: '#0a9cc2',
          700: '#087a99',
          800: '#085c73',
          900: '#073f4f',
          DEFAULT: '#13c2ec',
        },
        // Domain hues (CSS-var backed so they adapt per theme).
        fuel: 'rgb(var(--c-fuel) / <alpha-value>)',
        body: 'rgb(var(--c-body) / <alpha-value>)',
        train: 'rgb(var(--c-train) / <alpha-value>)',
        move: 'rgb(var(--c-move) / <alpha-value>)',
        heart: 'rgb(var(--c-heart) / <alpha-value>)',
        sleep: 'rgb(var(--c-sleep) / <alpha-value>)',
        violet: {
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          DEFAULT: '#8b5cf6',
        },
        success: { 400: '#4ade80', 500: '#22c55e', DEFAULT: '#22c55e' },
        warning: { 400: '#facc15', 500: '#eab308', DEFAULT: '#eab308' },
        error:   { 400: '#f87171', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c', DEFAULT: '#ef4444' },
      },
      backgroundImage: {
        'gradient-brand': 'linear-gradient(135deg, #13c2ec 0%, #4fe3a1 100%)',
      },
      boxShadow: {
        'glow-sm':  '0 0 16px rgba(0,184,217,0.18)',
        'card':     '0 1px 2px rgba(0,0,0,0.08)',
        'card-md':  '0 4px 16px rgba(0,0,0,0.12)',
        'dropdown': '0 8px 24px rgba(0,0,0,0.20), 0 0 0 1px var(--surface-border)',
      },
    },
  },
  plugins: [],
} satisfies Config
