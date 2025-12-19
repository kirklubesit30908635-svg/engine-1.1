import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Netlify serves at root; keep base as '/'
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
})
