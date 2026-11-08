import { describe, expect, it } from 'vitest';
import { loadChoices, saveChoices } from './musicChoices';

function memory(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

const track = {
  provider: 'spotify',
  id: 'nc000000000',
  title: 'Nightcall',
  startAtSec: 0,
} as const;

describe('musicChoices', () => {
  it('round-trips per experience', () => {
    const s = memory();
    expect(saveChoices('a', { s1: track }, s)).toBe(true);
    expect(loadChoices('a', s)).toEqual({ s1: track });
    expect(loadChoices('b', s)).toEqual({});
  });

  it('drops invalid entries and survives corrupt data', () => {
    const s = memory();
    s.setItem(
      'hypercycling.experience.music',
      JSON.stringify({
        a: { ok: track, bad: { provider: 'youtube', id: 'x', title: 't' }, id: 5 },
      }),
    );
    expect(loadChoices('a', s)).toEqual({ ok: track });
    s.setItem('hypercycling.experience.music', '{nope');
    expect(loadChoices('a', s)).toEqual({});
  });

  it('removes an experience when its choices are empty', () => {
    const s = memory();
    saveChoices('a', { s1: track }, s);
    saveChoices('a', {}, s);
    expect(loadChoices('a', s)).toEqual({});
  });

  it('reports a refusing storage', () => {
    const s = memory();
    s.setItem = () => {
      throw new Error('full');
    };
    expect(saveChoices('a', { s1: track }, s)).toBe(false);
  });
});
