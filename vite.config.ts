import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The screens talk to the engine (engine/bin/server.ts) through this proxy, as one origin.
// EM_UI_PORT runs a second copy beside the everyday one (e.g. 5174 while 5173 is in use);
// strictPort makes a clash an error instead of a quiet move to another port.
const port = Number(process.env.EM_UI_PORT ?? 5173)
const engine = process.env.EM_ENGINE ?? 'http://127.0.0.1:3100'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port,
    strictPort: true,
    proxy: {
      '/api': {
        target: engine,
        // Keep the browser's Host header: the engine refuses writes whose Origin doesn't match it.
        changeOrigin: false,
        // When the engine's side of a response breaks off (it restarted), break the browser's side
        // too. Otherwise the live-update stream stays open but silent, and never reconnects.
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes, _req, res) => {
            proxyRes.on('close', () => { if (!proxyRes.complete) res.destroy() })
          })
        },
      }
    }
  }
})
