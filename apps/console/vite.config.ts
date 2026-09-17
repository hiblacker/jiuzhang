import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  // Pages are addressed by real paths, so assets must resolve from the site root.
  base: '/',
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  server: { proxy: { '/api': 'http://127.0.0.1:60185' } },
  build: { sourcemap: false },
});
