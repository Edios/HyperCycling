import type { FastifyInstance, FastifyReply } from 'fastify';
import type { z } from 'zod';
import { parseExportBundle } from '../../domain/export-bundle';
import type { CollectionRepo, Repositories, SingletonRepo } from '../../domain/repositories';
import { backupDb } from '../backup';
import { schemas } from '../../storage/validation';

const IMPORT_BODY_LIMIT = 10 * 1024 * 1024;
const MAX_ID_LENGTH = 200;

export interface DataRoutesOptions {
  /** Where to snapshot the database before an import. Omit to skip (in-memory databases). */
  backup?: { db: { backup(toPath: string): Promise<unknown> }; dir: string } | undefined;
  now?: () => Date;
}

/** URL collection name -> repository key. */
const COLLECTIONS = {
  workouts: 'workouts',
  players: 'players',
  'plan-progress': 'planProgress',
  'session-logs': 'sessionLogs',
} as const;
type UrlCollection = keyof typeof COLLECTIONS;

const SINGLETONS = { settings: 'settings', 'active-session': 'activeSession' } as const;

function fail(reply: FastifyReply, status: number, error: string, details?: string): FastifyReply {
  return reply.code(status).send(details === undefined ? { error } : { error, details });
}

const idTooLong = (id: string): boolean => id.length > MAX_ID_LENGTH;

function issueText(error: z.ZodError): string {
  const i = error.issues[0];
  return i ? `${i.path.join('.')}: ${i.message}` : 'invalid';
}

export function registerDataRoutes(
  app: FastifyInstance,
  repos: Repositories,
  options: DataRoutesOptions = {},
): void {
  for (const [url, key] of Object.entries(SINGLETONS) as [
    keyof typeof SINGLETONS,
    (typeof SINGLETONS)[keyof typeof SINGLETONS],
  ][]) {
    const repo = repos[key] as SingletonRepo<unknown>;
    const schema = schemas[key];
    app.get(`/api/${url}`, async (_req, reply) => {
      const v = await repo.get();
      return v === undefined ? reply.code(204).send() : v;
    });
    app.put(`/api/${url}`, async (req, reply) => {
      const r = schema.safeParse(req.body);
      if (!r.success) return fail(reply, 400, `Invalid ${url}`, issueText(r.error));
      await repo.put(r.data as never);
      return reply.code(204).send();
    });
    app.delete(`/api/${url}`, async (_req, reply) => {
      await repo.clear();
      return reply.code(204).send();
    });
  }

  app.get('/api/export', async () => repos.exportAll());

  app.post('/api/import', { bodyLimit: IMPORT_BODY_LIMIT }, async (req, reply) => {
    const parsed = parseExportBundle(req.body);
    if (!parsed.ok) return fail(reply, 400, parsed.reason, parsed.details);
    if (options.backup) {
      try {
        await backupDb(
          options.backup.db,
          options.backup.dir,
          (options.now ?? (() => new Date()))(),
          (err) => req.log.warn(err),
        );
      } catch (err) {
        req.log.error(err);
        return fail(reply, 500, 'Backup failed, nothing was imported');
      }
    }
    await repos.replaceAll(parsed.bundle);
    return reply.code(204).send();
  });

  const lookup = (name: string): UrlCollection | undefined =>
    Object.hasOwn(COLLECTIONS, name) ? (name as UrlCollection) : undefined;
  const repoFor = (c: UrlCollection): CollectionRepo<{ id: string }> =>
    repos[COLLECTIONS[c]] as CollectionRepo<{ id: string }>;

  app.get<{ Params: { collection: string } }>('/api/:collection', async (req, reply) => {
    const c = lookup(req.params.collection);
    if (!c) return fail(reply, 404, 'Not found');
    return repoFor(c).list();
  });

  app.get<{ Params: { collection: string; id: string } }>(
    '/api/:collection/:id',
    async (req, reply) => {
      const c = lookup(req.params.collection);
      if (!c) return fail(reply, 404, 'Not found');
      if (idTooLong(req.params.id)) return fail(reply, 400, 'Invalid id');
      const item = await repoFor(c).get(req.params.id);
      return item === undefined ? fail(reply, 404, 'Not found') : item;
    },
  );

  app.put<{ Params: { collection: string; id: string } }>(
    '/api/:collection/:id',
    async (req, reply) => {
      const c = lookup(req.params.collection);
      if (!c) return fail(reply, 404, 'Not found');
      if (idTooLong(req.params.id)) return fail(reply, 400, 'Invalid id');
      const r = schemas[COLLECTIONS[c]].safeParse(req.body);
      if (!r.success) return fail(reply, 400, `Invalid ${c} item`, issueText(r.error));
      const item = r.data as { id: string };
      if (item.id !== req.params.id) return fail(reply, 400, 'Body id does not match URL id');
      await repoFor(c).put(item);
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { collection: string; id: string } }>(
    '/api/:collection/:id',
    async (req, reply) => {
      const c = lookup(req.params.collection);
      if (!c) return fail(reply, 404, 'Not found');
      if (idTooLong(req.params.id)) return fail(reply, 400, 'Invalid id');
      await repoFor(c).remove(req.params.id);
      return reply.code(204).send();
    },
  );
}
