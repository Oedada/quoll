import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// бэкенд и Keycloak договорены на 127.0.0.1:8000 — кука сессии привязана
// к этому хосту, поэтому dev-сервер тоже должен быть на 127.0.0.1, не localhost
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/auth': 'http://127.0.0.1:8000',
    },
  },
})
