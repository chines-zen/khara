import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import path from 'path';

// Single SPA build configuration: this is the only server now (see
// index.js, which serves the dist/ output built from here). tanstackRouter()
// keeps src/routeTree.gen.ts in sync with src/routes/*.tsx without needing
// the TanStack Start SSR plugin.
export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
    },
  },
  server: {
    port: 3000,
    // Local dev: `npm run dev` serves the UI here with HMR and proxies API
    // calls to the real backend (`npm start`, index.js) on port 8080.
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
});
