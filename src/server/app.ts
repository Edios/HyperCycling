import { readFileSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { createSqliteRepositories, type SqliteRepositories } from '../storage/sqlite';
import { serverConfig } from './config';
import { registerDataRoutes } from './routes/data';
import { registerSecurity } from './security';

export interface BuildServerOptions {
  /** SQLite file path, or ':memory:'. */
  dbPath: string;
  /** Directory with the built client. When set it is served at `/`. */
  staticDir?: string;
  logger?: boolean;
  /** Test seam: use these repositories instead of opening `dbPath`. */
  repositories?: SqliteRepositories;
  /** Port the server listens on (for the Host allowlist). Defaults to the configured port. */
  port?: number;
  /** Extra accepted `Host` values (`name:port`) beyond loopback on `port`. */
  extraAllowedHosts?: readonly string[];
  /** Extra accepted `Origin` values for state-changing requests. */
  extraAllowedOrigins?: readonly string[];
}

function readVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  };
  return pkg.version;
}

export async function buildServer(opts: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    // route handlers answer 400 for ids over 200 chars; keep the router from answering 414 first
    routerOptions: { maxParamLength: 1000 },
  });
  const version = readVersion();

  // Registered first so the Host/CSRF guards run before any route or the static handler.
  registerSecurity(app, {
    port: opts.port ?? serverConfig.port,
    ...(opts.extraAllowedHosts ? { extraAllowedHosts: opts.extraAllowedHosts } : {}),
    ...(opts.extraAllowedOrigins ? { extraAllowedOrigins: opts.extraAllowedOrigins } : {}),
  });

  const repos = opts.repositories ?? createSqliteRepositories(opts.dbPath);
  app.addHook('onClose', () => {
    repos.close();
  });

  // Never leak internals (stack traces) to clients.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) req.log.error(err);
    return reply
      .code(status)
      .send({ error: status >= 500 ? 'Internal server error' : err.message });
  });

  const dbLocation = opts.dbPath === ':memory:' ? opts.dbPath : path.resolve(opts.dbPath);
  app.get('/api/health', async () => ({ ok: true, version }));
  // The absolute path contains the OS user name, so it is not part of the health probe.
  app.get('/api/location', async () => ({ dbPath: dbLocation }));
  registerDataRoutes(app, repos, {
    // in-memory databases have nothing to back up
    backup:
      opts.dbPath === ':memory:'
        ? undefined
        : { db: repos, dir: path.join(path.dirname(opts.dbPath), 'backups') },
  });

  if (opts.staticDir) {
    await app.register(fastifyStatic, { root: opts.staticDir });
  }

  return app;
}
