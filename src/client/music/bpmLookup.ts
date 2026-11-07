/**
 * One tempo lookup for the editor: GetSongBPM first when the rider saved a key, Deezer (no key)
 * otherwise or when GetSongBPM does not know the song or fails. Song suggestions by tempo exist
 * only in GetSongBPM.
 */
import type { BpmSource } from '../../domain/workout';
import { useSettings } from '../data/useSettings';
import { createDeezerClient, type DeezerClient } from './deezer/client';
import {
  GetSongBpmError,
  identity,
  type BpmQuery,
  type GetSongBpmClient,
} from './getsongbpm/client';
import { getSharedGetSongBpmClient } from './getsongbpm/useGetSongBpm';

export interface TempoResult {
  bpm: number;
  source: BpmSource;
}

/** One song found by a free search. */
export interface SongCandidate {
  title: string;
  artist?: string;
  bpm: number;
  source: BpmSource;
  /** Page of the song at the provider. */
  url: string;
}

export type SongProvider = 'auto' | BpmSource;

export interface SongSearchResult {
  hits: SongCandidate[];
  /** Providers that failed while another one may still have answered. */
  errors: GetSongBpmError[];
}

export interface BpmLookup {
  /**
   * Search by artist and/or title. 'auto' asks every available provider and merges (the same
   * song and tempo from two providers is listed once, with the key holder's GetSongBPM first).
   * Throws only when every asked provider failed.
   */
  search(query: BpmQuery, provider?: SongProvider): Promise<SongSearchResult>;
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

function toError(err: unknown, provider: BpmSource): GetSongBpmError {
  return err instanceof GetSongBpmError ? err : new GetSongBpmError('network', provider);
}

export function createBpmLookup(gsbpm: GetSongBpmClient | undefined, dz: DeezerClient): BpmLookup {
  return {
    suggestions: gsbpm,
    async search(query, provider = 'auto') {
      const jobs: { source: BpmSource; run: Promise<SongCandidate[]> }[] = [];
      if (gsbpm && provider !== 'deezer') {
        jobs.push({
          source: 'getsongbpm',
          run: gsbpm
            .searchSongs(query)
            .then((hs) => hs.map((h) => ({ ...h, source: 'getsongbpm' as const }))),
        });
      }
      if (provider !== 'getsongbpm') {
        jobs.push({
          source: 'deezer',
          run: dz
            .searchSongs(query)
            .then((hs) => hs.map((h) => ({ ...h, source: 'deezer' as const }))),
        });
      }
      if (jobs.length === 0) throw new GetSongBpmError('no-key');
      const settled = await Promise.allSettled(jobs.map((j) => j.run));
      const hits: SongCandidate[] = [];
      const errors: GetSongBpmError[] = [];
      settled.forEach((r, i) => {
        if (r.status === 'fulfilled') hits.push(...r.value);
        else errors.push(toError(r.reason, (jobs[i] as (typeof jobs)[number]).source));
      });
      if (errors.length === jobs.length) throw errors[0] as GetSongBpmError;
      const seen = new Set<string>();
      const unique = hits.filter((h) => {
        const k = `${identity(h.artist ?? '')}|${identity(h.title)}|${h.bpm}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      return { hits: unique, errors };
    },
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
