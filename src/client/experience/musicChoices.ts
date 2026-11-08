import { BPM_MAX, BPM_MIN } from '../../domain/bpm-match';
import type { TrackRef } from '../../domain/workout';
import { readCompat, type KeyValueStorage } from '../data/storage-compat';

/**
 * The rider's matched tracks per Experience, kept in this browser only (slot id -> the slot's
 * queue of Spotify tracks). Never part of the repository or of exports. An older save holds one
 * track per slot; it reads as a one-track queue.
 */
export type Choices = Record<string, TrackRef[]>;
const MAX_TRACKS = 13;

const KEY = 'hypercycling.experience.music';
const ID = /^[A-Za-z0-9]{10,32}$/;
const TEXT = 200;

function defaultStorage(): KeyValueStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function validTrack(v: unknown): TrackRef | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const o = v as Record<string, unknown>;
  if (o.provider !== 'spotify' || typeof o.id !== 'string' || !ID.test(o.id)) return undefined;
  if (typeof o.title !== 'string' || o.title.length > TEXT) return undefined;
  if (o.artist !== undefined && (typeof o.artist !== 'string' || o.artist.length > TEXT)) {
    return undefined;
  }
  const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
  return {
    provider: 'spotify',
    id: o.id,
    title: o.title,
    ...(typeof o.artist === 'string' ? { artist: o.artist } : {}),
    ...(num(o.durationSec) ? { durationSec: o.durationSec } : {}),
    startAtSec: num(o.startAtSec) ? o.startAtSec : 0,
    ...(num(o.bpm) && o.bpm >= BPM_MIN && o.bpm <= BPM_MAX ? { bpm: o.bpm } : {}),
  };
}

function readAll(storage: KeyValueStorage | undefined): Record<string, Choices> {
  try {
    const raw = storage ? readCompat(storage, KEY) : null;
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, Choices> = {};
    for (const [exp, slots] of Object.entries(parsed)) {
      if (typeof slots !== 'object' || slots === null) continue;
      const c: Choices = {};
      for (const [slot, t] of Object.entries(slots)) {
        const list = (Array.isArray(t) ? t : [t]).slice(0, MAX_TRACKS);
        const ok = list.flatMap((x) => validTrack(x) ?? []);
        if (ok.length > 0) c[slot] = ok;
      }
      out[exp] = c;
    }
    return out;
  } catch {
    return {};
  }
}

export function loadChoices(experienceId: string, storage = defaultStorage()): Choices {
  return readAll(storage)[experienceId] ?? {};
}

/** Saves the choices of one Experience; an empty set removes it. False when storage refuses. */
export function saveChoices(
  experienceId: string,
  choices: Choices,
  storage = defaultStorage(),
): boolean {
  const all = readAll(storage);
  if (Object.keys(choices).length === 0) delete all[experienceId];
  else all[experienceId] = choices;
  try {
    if (!storage) return false;
    storage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}
