import { useCallback, useSyncExternalStore } from 'react';
import type { Lang } from '../../domain/lang';
import { en, type Messages } from './en';
import { pl } from './pl';

export type { Lang } from '../../domain/lang';

type Params = Record<string, string | number>;

/** Union of dotted paths to leaf strings of a nested dictionary. */
type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

export type MessageKey = Paths<Messages>;

const dictionaries: Record<Lang, Messages> = { en, pl };

export function detectLang(navigatorLanguage: string): Lang {
  return navigatorLanguage.toLowerCase().startsWith('pl') ? 'pl' : 'en';
}

let current: Lang = detectLang(typeof navigator === 'undefined' ? 'en' : navigator.language);
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function lookup(dict: Messages, key: MessageKey): string {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : key;
}

export function t(key: MessageKey, params?: Params, lang: Lang = current): string {
  const text = lookup(dictionaries[lang], key);
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function useLang(): [Lang, (l: Lang) => void] {
  const lang = useSyncExternalStore(subscribe, getLang, getLang);
  return [lang, setLang];
}

export function useT(): (key: MessageKey, params?: Params) => string {
  const lang = useSyncExternalStore(subscribe, getLang, getLang);
  return useCallback((key, params) => t(key, params, lang), [lang]);
}
