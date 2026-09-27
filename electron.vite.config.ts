import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'import-worker': resolve('src/main/import/import-worker.ts'),
          'preview-worker': resolve('src/main/import/preview-worker.ts')
        },
        output: { entryFileNames: '[name].js' }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: { output: { entryFileNames: '[name].js', format: 'cjs' } }
    }
  },
  renderer: {
    plugins: [vue(), tailwindcss()],
    server: { host: '127.0.0.1' },
    resolve: { alias: { '@': resolve('src/renderer/src') } }
  }
})
