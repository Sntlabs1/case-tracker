import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import vercelApi from './tools/vercel-api-plugin.js'

export default defineConfig({
  plugins: [react(), vercelApi()],
  server: {
    port: 3030,
    strictPort: false,
    open: false
  },
  build: {
    outDir: 'dist'
  }
})
