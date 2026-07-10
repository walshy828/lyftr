import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    // Self-signed HTTPS so getUserMedia works on mobile LAN during dev.
    // Production HTTPS is handled by the reverse proxy (nginx/Caddy) — this never runs in builds.
    ...(command === 'serve' ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'Lyftr - Workout Tracking',
        short_name: 'Lyftr',
        description: 'Self-hosted workout tracker',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#00b8d9',
        background_color: '#070d1a',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache only the built app shell — this is not an offline-first
        // app; data always needs the network.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [{ urlPattern: /^\/api\//, handler: 'NetworkOnly' }],
      },
      devOptions: { enabled: true },
    }),
  ],
  server: {
    port: 5173,
    host: true, // expose to LAN for mobile testing
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
}))
