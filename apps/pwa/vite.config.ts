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
        name: 'Konstruct',
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
    // Middleware для правильной обработки WASM и CSS файлов
    {
      name: 'mime-type-fixes',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.endsWith('.wasm')) {
            res.setHeader('Content-Type', 'application/wasm');
          } else if (req.url?.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css');
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
    },
    // Proxy для обхода CORS при разработке
    proxy: {
      '/api': {
        target: 'https://ams.konstruct.cc',
        changeOrigin: true,
        secure: false, // Если сервер использует самоподписанный сертификат
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.log('proxy error', err);
          });
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            console.log('Sending Request to the Target:', req.method, req.url);
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            console.log('Received Response from the Target:', proxyRes.statusCode, req.url);
          });
        },
      }
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
