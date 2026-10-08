import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const contracts = fileURLToPath(new URL('../../packages/contracts/src/index.ts', import.meta.url));
const apiTarget = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@appraisal/contracts': contracts } },
  server: {
    port: 5173,
    // acme.localhost, globex.localhost, admin.localhost … all resolve to 127.0.0.1 in modern browsers.
    allowedHosts: ['.localhost'],
    // The proxy keeps the browser's Host header, so the API sees the tenant sub-domain.
    proxy: { '/api': { target: apiTarget, changeOrigin: false, xfwd: true } },
  },
  preview: { port: 4173, allowedHosts: ['.localhost'], proxy: { '/api': { target: apiTarget, changeOrigin: false, xfwd: true } } },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    globals: true,
  },
});
