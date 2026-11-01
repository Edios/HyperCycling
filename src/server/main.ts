import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { buildServer } from './app';
import { serverConfig } from './config';

export { serverConfig };

const staticDir = process.env.STATIC_DIR ? path.resolve(process.env.STATIC_DIR) : undefined;
const dbPath = process.env.DB_PATH ?? path.resolve('data', 'spinning-tutor.db');
if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });

const app = await buildServer({
  dbPath,
  logger: true,
  ...(staticDir ? { staticDir } : {}),
});
try {
  await app.listen(serverConfig);
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(`Port ${serverConfig.port} is busy — is HyperCycling already running?`);
  } else {
    console.error(err);
  }
  process.exit(1);
}
