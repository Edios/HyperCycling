import type { FastifyInstance } from 'fastify';
import { BRIDGE_CSP, DEEZER_BRIDGE_FILE, SERVER_CSP } from '../shared/csp';

export interface SecurityOptions {
  /** Port the server listens on; only loopback names with this port are accepted as `Host`. */
  port: number;
  /** Extra accepted `Host` values (`name:port`, case-insensitive). */
  extraAllowedHosts?: readonly string[];
  /** Extra accepted `Origin` values for state-changing requests. */
  extraAllowedOrigins?: readonly string[];
  /** Also accept the Vite dev server's origin (only when the server does not serve the build). */
  trustDevClient?: boolean;
}

/** Port of the Vite dev server, which proxies `/api` to us in development. */
export const DEV_CLIENT_PORT = 5173;

const LOOPBACK_NAMES = ['127.0.0.1', 'localhost', '[::1]'] as const;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Local-server hardening:
 *  - Host allowlist: a DNS-rebinding page reaches us through a hostname it controls, so every
 *    request whose Host is not a loopback name on our port is refused (421), before any route.
 *  - Cross-site guard on PUT/POST/DELETE: a foreign `Origin` or a cross-site `Sec-Fetch-Site` is
 *    refused (403), and only `application/json` bodies are accepted (415), so a plain HTML form or
 *    a `text/plain` fetch (both skip the CORS preflight) can never reach a handler.
 *  - Security headers on every response, including the refusals above.
 */
export function registerSecurity(app: FastifyInstance, opts: SecurityOptions): void {
  const hosts = new Set<string>([
    ...LOOPBACK_NAMES.map((n) => `${n}:${opts.port}`),
    ...(opts.extraAllowedHosts ?? []).map((h) => h.toLowerCase()),
  ]);
  const origins = new Set<string>([
    ...LOOPBACK_NAMES.flatMap((n) => [
      `http://${n}:${opts.port}`,
      ...(opts.trustDevClient ? [`http://${n}:${DEV_CLIENT_PORT}`] : []),
    ]),
    ...(opts.extraAllowedOrigins ?? []).map((o) => o.toLowerCase()),
  ]);

  // The built-in text/plain parser would turn a simple cross-site POST into a string body.
  app.removeContentTypeParser('text/plain');

  app.addHook('onSend', async (req, reply) => {
    // The sandboxed Deezer bridge page (and its script) is the one document with another policy:
    // it may run script from api.deezer.com, and only our own page may frame it.
    const bridge = new URL(req.url, 'http://localhost').pathname.endsWith(`/${DEEZER_BRIDGE_FILE}`);
    reply.header(
      'content-security-policy',
      bridge ? `${BRIDGE_CSP}; frame-ancestors 'self'` : SERVER_CSP,
    );
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('x-frame-options', bridge ? 'SAMEORIGIN' : 'DENY');
  });

  app.addHook('onRequest', async (req, reply) => {
    if (!hosts.has((req.headers.host ?? '').toLowerCase())) {
      return reply.code(421).send({ error: 'Misdirected request' });
    }
    if (SAFE_METHODS.has(req.method)) return undefined;

    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin' && site !== 'none') {
      return reply.code(403).send({ error: 'Cross-site request refused' });
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !origins.has(origin.toLowerCase())) {
      return reply.code(403).send({ error: 'Cross-site request refused' });
    }
    const type = req.headers['content-type'];
    if (type !== undefined && type.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
      return reply.code(415).send({ error: 'Content-Type must be application/json' });
    }
    return undefined;
  });
}
