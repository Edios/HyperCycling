import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { en } from './en';
import { pl } from './pl';
import { detectLang, setLang, t, useLang, useT } from './index';

function flatten(obj: object, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v as object, key));
  }
  return out;
}

afterEach(() => setLang('en'));

describe('i18n', () => {
  it('detects Polish from pl-PL', () => expect(detectLang('pl-PL')).toBe('pl'));
  it('falls back to en', () => expect(detectLang('de-DE')).toBe('en'));
  it('interpolates params', () =>
    expect(t('training.cadenceCue', { rpm: 100 }, 'pl')).toBe('Kadencja 100!'));
  it('pl has every en key', () =>
    expect(Object.keys(flatten(pl)).sort()).toEqual(Object.keys(flatten(en)).sort()));
  it('uses the current language when lang is omitted', () => {
    setLang('pl');
    expect(t('coach.attack')).toBe('ATAK!');
  });
  it('keeps unknown placeholders intact', () =>
    expect(t('training.blockOf', { n: 2 }, 'en')).toBe('block 2 of {total}'));
  it('useT and useLang react to language changes', () => {
    const { result } = renderHook(() => ({ t: useT(), lang: useLang() }));
    expect(result.current.t('coach.attack')).toBe('ATTACK!');
    act(() => result.current.lang[1]('pl'));
    expect(result.current.lang[0]).toBe('pl');
    expect(result.current.t('coach.attack')).toBe('ATAK!');
  });
});
