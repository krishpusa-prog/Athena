import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './', // required so the packaged app can load assets via file://
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
})