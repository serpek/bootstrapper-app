import react from '@vitejs/plugin-react-swc'
import path from 'node:path'
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import tsconfigPaths from 'vite-tsconfig-paths'

// https://vite.dev/config/
export default defineConfig({
  server: {
    port: 3000
  },

  plugins: [
    react({
      tsDecorators: true
    }),
    nodePolyfills(),
    tsconfigPaths()
  ],
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true
      }
    }
  },
  resolve: {
    alias: {
      '@bipweb/utils': path.resolve(__dirname, './src/api/utils'),
      '@bipweb/shared': path.resolve(__dirname, './src/api/shared'),
      '@bipweb/common': path.resolve(__dirname, './src/api/common'),
      '@bipweb/core': path.resolve(__dirname, './src/api/core'),
      '@bipweb/data': path.resolve(__dirname, './src/api/data'),
      '@bipweb/business': path.resolve(__dirname, './src/api/business')
    }
  }
})
