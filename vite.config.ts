import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import type { Plugin } from 'vite'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// kuromoji 辞書ファイルを正しくバイナリとして配信するプラグイン
// Vite が .gz.bin を Content-Encoding: gzip で配信しないよう強制上書きする
function kuromijiDictPlugin(): Plugin {
  return {
    name: 'kuromoji-dict-headers',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.includes('/kuromoji-dict/')) {
          res.setHeader('Content-Encoding', 'identity')
          res.setHeader('Content-Type', 'application/octet-stream')
        }
        next()
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      pako: resolve(__dirname, 'node_modules/pako/dist/pako.js'),
      'zlibjs/bin/gunzip.min.js': resolve(__dirname, 'src/utils/zlib-shim.ts'),
    },
  },
  optimizeDeps: {
    include: ['kuromoji', 'pako'],
  },
  plugins: [
    react(),
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      protocolImports: true,
    }),
    kuromijiDictPlugin(),
  ],
})
