import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));
const api = `http://localhost:${process.env.API_PORT || 3001}`;

// In dev the browser talks to Vite on :3000 (the registered OIDC redirect
// origin) and Vite proxies API, auth, and media requests to Express.
export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    strictPort: true,
    fs: { allow: [path.resolve(root, '..')] },
    proxy: Object.fromEntries(['/api', '/auth', '/media', '/healthz'].map((p) => [p, { target: api, changeOrigin: false }])),
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
});
