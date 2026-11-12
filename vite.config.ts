import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://39.185.83.71:8001', changeOrigin: true },
      '/ws': { target: 'ws://39.185.83.71:8001', ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 1500 },
})
