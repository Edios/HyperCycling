import type { Repositories } from '../../domain/repositories';

let instance: Promise<Repositories> | undefined;

async function create(): Promise<Repositories> {
  // Dynamic imports keep the unused implementation out of the bundle for each build.
  if (import.meta.env.VITE_STORAGE === 'indexeddb') {
    const { createIndexedDbRepositories } = await import('../../storage/indexeddb');
    return createIndexedDbRepositories();
  }
  const { createHttpRepositories } = await import('../../storage/http');
  return createHttpRepositories(location.origin);
}

/** Process-wide repositories chosen by `VITE_STORAGE` (`indexeddb`, otherwise the local HTTP API). */
export function getRepositories(): Promise<Repositories> {
  instance ??= create().catch((err: unknown) => {
    instance = undefined; // allow a retry after a failed open
    throw err;
  });
  return instance;
}

export function resetRepositoriesForTests(): void {
  instance = undefined;
}
