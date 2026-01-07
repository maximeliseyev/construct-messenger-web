import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'Construct Messenger',
        short_name: 'Construct',
        description: 'Secure PWA Messenger',
        theme_color: '#ffffff',
        icons: [
          {
            src: 'icon.png', // path in public folder
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
    // Middleware для правильной обработки WASM файлов
    {
      name: 'wasm-mime-type',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.endsWith('.wasm')) {
            res.setHeader('Content-Type', 'application/wasm');
          }
          next();
        });
      }
    }
  ],
  server: {
    fs: {
      // Allow serving WASM files
      allow: ['..']
    }
  },
  optimizeDeps: {
    exclude: ['construct-core', 'construct_core']
  },
  assetsInclude: ['**/*.wasm'],
  worker: {
    format: 'es'
  },
  // Настройка для правильной обработки WASM файлов
  build: {
    rollupOptions: {
      output: {
        // Сохранить структуру для WASM файлов
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.wasm')) {
            return 'assets/[name][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        }
      }
    }
  }
})
