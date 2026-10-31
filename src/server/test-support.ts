import type { FastifyInstance } from 'fastify';
import { buildServer, type BuildServerOptions } from './app';

/**
 * `app.inject` sends `Host: localhost:80` unless told otherwise, so tests that do not care about
 * the Host allowlist build the server for port 80. Security tests set the host explicitly.
 */
export function buildTestServer(opts: BuildServerOptions): Promise<FastifyInstance> {
  return buildServer({ port: 80, ...opts });
}
