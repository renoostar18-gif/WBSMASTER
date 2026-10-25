import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: { conditions: ['development'] },
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: false } },
  },
  // the demo is packed into one HTML file (scripts/build-demo.mjs), so it needs a single script
  build: mode === 'demo'
    ? { outDir: 'dist-demo', assetsInlineLimit: 100_000_000, rollupOptions: { output: { inlineDynamicImports: true } } }
    : {},
  test: { include: ['test/**/*.test.ts'] },
}) as never);
