import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    // Express listens on 3000 (server.js default) — keep these in sync
    proxy: {
      "/api": "http://localhost:3000"
    }
  }
})
