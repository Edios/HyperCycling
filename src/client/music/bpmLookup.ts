/**
 * One tempo lookup for the editor: GetSongBPM first when the rider saved a key, Deezer (no key)
 * otherwise or when GetSongBPM does not know the song or fails. Song suggestions by tempo exist
 * only in GetSongBPM.
 */
import type { BpmSource } from '../../domain/workout';
import { useSettings } from '../data/useSettings';
import { createDeezerClient, type DeezerClient } from './deezer/client';
import { GetSongBpmError, type BpmQuery, type GetSongBpmClient } from './getsongbpm/client';
import { getSharedGetSongBpmClient } from './getsongbpm/useGetSongBpm';

export interface TempoResult {
  bpm: number;
  source: BpmSource;
}

export interface BpmLookup {
  lookup(query: BpmQuery): Promise<TempoResult | undefined>;
  /** Present only with a GetSongBPM key. */
  suggestions: GetSongBpmClient | undefined;
}

let deezer: DeezerClient | undefined;
export function getSharedDeezerClient(): DeezerClient {
  deezer ??= createDeezerClient();
  return deezer;
}
/** Tests swap in a stub (the real client loads <script> tags); no argument restores the default. */
export function setDeezerClientForTests(client?: DeezerClient): void {
  deezer = client;
}

export function createBpmLookup(gsbpm: GetSongBpmClient | undefined, dz: DeezerClient): BpmLookup {
  return {
    suggestions: gsbpm,
    async lookup(query) {
      let firstError: unknown;
      if (gsbpm) {
        try {
          const hit = await gsbpm.lookupBpm(query);
          if (hit) return { bpm: hit.bpm, source: 'getsongbpm' };
        } catch (err) {
          firstError = err;
        }
      }
      try {
        const hit = await dz.lookupBpm(query);
        if (hit) return { bpm: hit.bpm, source: 'deezer' };
      } catch (err) {
        // The key holder's own problem (e.g. a rejected key) is reported first, else Deezer's.
        throw (
          firstError ??
          (err instanceof GetSongBpmError ? err : new GetSongBpmError('network', 'deezer'))
        );
      }
      if (firstError) throw firstError;
      return undefined;
    },
  };
}

export function useBpmLookup(): BpmLookup {
  const gsbpm = getSharedGetSongBpmClient(useSettings().settings.getSongBpmKey);
  return createBpmLookup(gsbpm, getSharedDeezerClient());
}
