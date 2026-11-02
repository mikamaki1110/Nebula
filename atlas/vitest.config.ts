import { fileURLToPath } from 'url'
import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root,
  resolve: { alias: { '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] }
})
