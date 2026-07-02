/** NativeWind (Tailwind for RN). Tokens ported from web/tailwind.config.ts +
 *  index.css. MVP ships the app's DARK palette as the fixed theme (the web app's
 *  .dark values); light-mode + CSS-variable theming can follow later. */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './src/**/*.{js,ts,jsx,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Surfaces (from index.css .dark)
        surface: {
          base: '#070d1a',
          raised: '#0d1629',
          overlay: '#111e35',
          border: '#1c2f50',
          muted: '#162240',
        },
        // Text (from index.css .dark)
        tx: {
          primary: '#f1f5f9',
          secondary: '#94a3b8',
          muted: '#475569',
          inverse: '#0f172a',
        },
        // Brand — electric cyan (from web tailwind.config)
        brand: {
          50: '#e0f9ff',
          100: '#b0f1fe',
          200: '#7ae7fd',
          300: '#38d8fb',
          400: '#0ecef7',
          500: '#00b8d9',
          600: '#0099b8',
          700: '#007a96',
          800: '#005c72',
          900: '#003d4d',
          DEFAULT: '#00b8d9',
        },
        violet: { 400: '#a78bfa', 500: '#8b5cf6', 600: '#7c3aed', DEFAULT: '#8b5cf6' },
        success: { 400: '#4ade80', 500: '#22c55e', DEFAULT: '#22c55e' },
        warning: { 400: '#facc15', 500: '#eab308', DEFAULT: '#eab308' },
        error: { 400: '#f87171', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c', DEFAULT: '#ef4444' },
      },
    },
  },
  plugins: [],
}
