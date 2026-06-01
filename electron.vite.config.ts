import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
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
    // Externalize node deps (dugite, the ACP SDK, the adapter) instead of bundling
    // them. dugite resolves its embedded git relative to its own files in
    // node_modules; bundling breaks that path resolution (ENOENT on git).
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: resolve(__dirname, 'electron/main/index.ts') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
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
