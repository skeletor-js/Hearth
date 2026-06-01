import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

// Three build targets: main (Node), preload (Node, sandboxed bridge), renderer (web).
// The renderer is where all self-evolvable code lives — it is served by a live
// Vite dev server so agent edits hot-reload. In dev that is electron-vite's own
// server; the packaged self-evolving build (see docs/ARCHITECTURE.md) ships this
// same server inside the app rather than a frozen bundle.
export default defineConfig({
  main: {
    build: {
      lib: { entry: resolve(__dirname, 'electron/main/index.ts') },
    },
  },
  preload: {
    build: {
      lib: { entry: resolve(__dirname, 'electron/preload/index.ts') },
    },
  },
  renderer: {
    root: '.',
    resolve: {
      alias: { '@': resolve(__dirname, 'src') },
    },
    plugins: [
      tanstackRouter({ target: 'react', routesDirectory: 'src/routes' }),
      react(),
      tailwind(),
    ],
    build: {
      rollupOptions: { input: resolve(__dirname, 'index.html') },
    },
  },
})
