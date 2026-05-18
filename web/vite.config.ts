import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packagedSharedSrc = path.resolve(here, 'shared-src');
// Production image builds copy the needed shared files inside web/shared-src;
// local development falls back to the repo-root source files.
const sharedSrcRoot = fs.existsSync(packagedSharedSrc) ? packagedSharedSrc : path.resolve(here, '../src');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(here, 'src'),
      '@contracts': path.resolve(sharedSrcRoot, 'contracts/index.ts'),
      '@protocol': path.resolve(sharedSrcRoot, 'realtime/protocol.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
      '/ws': { target: 'http://localhost:3000', ws: true, changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.spec.{ts,tsx}'],
  },
});
