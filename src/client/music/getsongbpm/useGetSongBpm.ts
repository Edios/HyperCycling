import { useSettings } from '../../data/useSettings';
import { createGetSongBpmClient, type GetSongBpmClient } from './client';

let shared: { key: string; client: GetSongBpmClient } | undefined;

/** One client per key for the whole app, so the request budget is shared by every editor field. */
export function getSharedGetSongBpmClient(key: string | undefined): GetSongBpmClient | undefined {
  const k = key?.trim();
  if (!k) return undefined;
  if (shared?.key !== k) shared = { key: k, client: createGetSongBpmClient({ apiKey: k }) };
  return shared.client;
}

export function resetGetSongBpmClientForTests(): void {
  shared = undefined;
}

/** The client for the key saved in Settings, or undefined when there is none. */
export function useGetSongBpmClient(): GetSongBpmClient | undefined {
  return getSharedGetSongBpmClient(useSettings().settings.getSongBpmKey);
}
