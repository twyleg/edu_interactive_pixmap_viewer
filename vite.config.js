import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Change "interactive-pixmap-viewer" to your GitHub repo name
export default defineConfig({
  plugins: [react()],
  base: '/playground_react_vite_github_pages/',
})
