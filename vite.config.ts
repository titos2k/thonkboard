import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  base: '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webp}'],
        navigateFallback: 'index.html',
      },
      manifest: {
        name: 'ThonkBoard',
        short_name: 'ThonkBoard',
        description: 'A spatial canvas for thinking, with AI that questions and expands your ideas',
        theme_color: '#eeece8',
        background_color: '#eeece8',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/favicon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/favicon-512.png', sizes: '512x512', type: 'image/png' },
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        file_handlers: [
          {
            action: '/',
            accept: { 'application/x-thonk': ['.thonk'], 'application/json': ['.json'] },
            icons: [{ src: '/favicon-192.png', sizes: '192x192', type: 'image/png' }],
            launch_type: 'single-client',
          },
        ],
      } as any,
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
