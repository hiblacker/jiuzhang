import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
export default defineConfig(({ mode }) => ({
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: { 'import.meta.env.VITE_API_MODE': JSON.stringify(mode === 'real' ? 'real' : 'mock') },
  publicDir: mode === 'real' ? false : 'public',
  build: { outDir: mode === 'real' ? 'dist-real' : 'dist' },
  server: {
    host: '127.0.0.1',
    port: mode === 'real' ? 5175 : 5174,
    strictPort: true,
    proxy: mode === 'real' ? { '/api/v1': { target: 'http://127.0.0.1:8080' } } : undefined,
  },
}))
