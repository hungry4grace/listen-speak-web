import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // phraseSplitter imports the vendored segmenter at the repo root, one level
  // above this app's Vite root, so the dev server must be allowed to read it.
  server: { fs: { allow: ['..'] } },
  plugins: [react()],
})
