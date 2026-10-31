import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { PAGE_CSP } from './src/shared/csp';

/**
 * Embeds the Content-Security-Policy as a `<meta>` tag in production builds (GitHub Pages cannot
 * send headers; the local server also sends it as a header). Skipped in dev, where Vite's HMR
 * needs inline scripts and a websocket.
 */
function cspMeta(): Plugin {
  return {
    name: 'spinning-tutor:csp-meta',
    apply: 'build',
    // Right after the charset meta (which must stay within the first 1024 bytes) and before any
    // script or stylesheet tag, because a meta CSP only governs what is parsed after it.
    transformIndexHtml: (html) =>
      html.replace(
        /<meta charset="UTF-8"\s*\/?>/i,
        (charset) =>
          `${charset}\n    <meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}" />`,
      ),
  };
}

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  // Vite would inline a small modulepreload polyfill; the CSP has no 'unsafe-inline' for scripts.
  build: { modulePreload: { polyfill: false } },
  plugins: [react(), cspMeta()],
  server: {
    host: '127.0.0.1',
    // changeOrigin makes the API server see its own Host (it only accepts loopback + its port).
    proxy: { '/api': { target: 'http://127.0.0.1:5175', changeOrigin: true } },
  },
});
