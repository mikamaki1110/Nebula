/**
 * Baut ATLAS nach atlas/out/ – Nebula lädt es von dort.
 * Aufruf aus dem Nebula-Hauptordner: npm run build:atlas
 */
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const r = (p: string): string => resolve('atlas', p)
const alias = { '@shared': r('src/shared') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { outDir: r('out/main'), rollupOptions: { input: { index: r('src/main/index.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { outDir: r('out/preload'), rollupOptions: { input: { index: r('src/preload/index.ts') } } }
  },
  renderer: {
    root: r('src/renderer'),
    plugins: [react()],
    resolve: { alias },
    build: { outDir: r('out/renderer'), rollupOptions: { input: { index: r('src/renderer/index.html') } } }
  }
})
