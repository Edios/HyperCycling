import path from 'node:path';
import { buildServer } from './app';

const HOST = '127.0.0.1';
const port = Number(process.env.PORT ?? 5175);
const staticDir = process.env.STATIC_DIR ? path.resolve(process.env.STATIC_DIR) : undefined;

const app = await buildServer({
  dbPath: process.env.DB_PATH ?? path.resolve('data', 'spinning-tutor.db'),
  logger: true,
  ...(staticDir ? { staticDir } : {}),
});
await app.listen({ host: HOST, port });
