import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import {
  defineConfig,
  type Plugin,
  type PreviewServer,
  type ViteDevServer,
} from 'vite'

/** `/b/<id>` is one page; the dev and preview servers must serve it. */
function boardRoutes(): Plugin {
  const rewrite = (server: ViteDevServer | PreviewServer): void => {
    server.middlewares.use((req, _res, next) => {
      if (req.url?.startsWith('/b/')) {
        req.url = '/board.html'
      }
      next()
    })
  }
  return {
    name: 'tlwb-board-routes',
    configureServer: rewrite,
    configurePreviewServer: rewrite,
  }
}

export default defineConfig({
  plugins: [react(), boardRoutes()],
  appType: 'mpa',
  build: {
    rollupOptions: {
      input: {
        landing: resolve(__dirname, 'index.html'),
        board: resolve(__dirname, 'board.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
})
