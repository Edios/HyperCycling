import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { injectCspMeta } from './src/shared/cspMeta';

/**
 * Embeds the Content-Security-Policy as a `<meta>` tag in production builds (GitHub Pages cannot
 * send headers; the local server also sends it as a header). Skipped in dev, where Vite's HMR
 * needs inline scripts and a websocket.
 */
function cspMeta(): Plugin {
  return {
    name: 'spinning-tutor:csp-meta',
    apply: 'build',
    transformIndexHtml: injectCspMeta,
  };
}

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};

export default defineConfig({
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(version) },
  base: process.env.VITE_BASE ?? '/',
  // Vite would inline a small modulepreload polyfill; the CSP has no 'unsafe-inline' for scripts.
  build: { modulePreload: { polyfill: false } },
  plugins: [react(), cspMeta()],
  server: {
    host: '127.0.0.1',
    // The API only trusts the dev origin on 5173; silently moving to another port would break it.
    strictPort: true,
    // changeOrigin makes the API server see its own Host (it only accepts loopback + its port).
    proxy: { '/api': { target: 'http://127.0.0.1:5175', changeOrigin: true } },
  },
});
