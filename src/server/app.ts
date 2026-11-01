import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

export interface BuildServerOptions {
  /** SQLite file path. Accepted now, used from the storage task onwards. */
  dbPath: string;
  /** Directory with the built client. When set it is served at `/`. */
  staticDir?: string;
  logger?: boolean;
}

function readVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  };
  return pkg.version;
}

export async function buildServer(opts: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  const version = readVersion();

  app.get('/api/health', async () => ({ ok: true, version }));

  if (opts.staticDir) {
    await app.register(fastifyStatic, { root: opts.staticDir });
  }

  return app;
}
