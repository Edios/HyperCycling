import type { ExportBundle } from '../../domain/export-bundle';
import type { CollectionRepo, Repositories, SingletonRepo } from '../../domain/repositories';

/** Client side of the local REST API. The server validates; this only moves JSON. */
export function createHttpRepositories(
  baseUrl: string,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): Repositories {
  const base = baseUrl.replace(/\/+$/, '');

  async function call(path: string, method: string, body?: unknown): Promise<Response> {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const res = await fetchImpl(`${base}${path}`, init);
    if (res.ok || res.status === 404) return res;
    let message = `Request failed: ${method} ${path} (${res.status})`;
    try {
      const data = (await res.json()) as { error?: unknown; details?: unknown };
      if (typeof data.error === 'string') {
        message = typeof data.details === 'string' ? `${data.error}: ${data.details}` : data.error;
      }
    } catch {
      // keep the generic message
    }
    throw new Error(message);
  }

  const orThrow = async (path: string, method: string, body?: unknown): Promise<Response> => {
    const res = await call(path, method, body);
    if (res.status === 404) throw new Error(`Not found: ${method} ${path}`);
    return res;
  };

  function collection<T extends { id: string }>(url: string): CollectionRepo<T> {
    return {
      async list() {
        return (await (await orThrow(`/api/${url}`, 'GET')).json()) as T[];
      },
      async get(id) {
        const res = await call(`/api/${url}/${encodeURIComponent(id)}`, 'GET');
        return res.status === 404 ? undefined : ((await res.json()) as T);
      },
      async put(item) {
        await orThrow(`/api/${url}/${encodeURIComponent(item.id)}`, 'PUT', item);
      },
      async remove(id) {
        await orThrow(`/api/${url}/${encodeURIComponent(id)}`, 'DELETE');
      },
    };
  }

  function singleton<T>(url: string): SingletonRepo<T> {
    return {
      async get() {
        const res = await orThrow(`/api/${url}`, 'GET');
        return res.status === 204 ? undefined : ((await res.json()) as T);
      },
      async put(v) {
        await orThrow(`/api/${url}`, 'PUT', v);
      },
      async clear() {
        await orThrow(`/api/${url}`, 'DELETE');
      },
    };
  }

  return {
    workouts: collection('workouts'),
    players: collection('players'),
    planProgress: collection('plan-progress'),
    sessionLogs: collection('session-logs'),
    settings: singleton('settings'),
    activeSession: singleton('active-session'),
    async exportAll() {
      return (await (await orThrow('/api/export', 'GET')).json()) as ExportBundle;
    },
    async replaceAll(b) {
      await orThrow('/api/import', 'POST', b);
    },
  };
}
