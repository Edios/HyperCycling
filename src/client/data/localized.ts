import type { Lang, Localized } from '../../domain/lang';
import type { SongSlot, Workout } from '../../domain/workout';

interface HasText {
  name: string;
  description: string;
  localized?: Partial<Record<Lang, Localized>>;
}

/** Name and description in `lang`, falling back to the base fields. */
export function localizedText(item: HasText, lang: Lang): Localized {
  const loc = item.localized?.[lang];
  return {
    name: loc?.name || item.name,
    description: loc?.description || item.description,
  };
}

/** Song-slot hint in `lang`, falling back to the slot's own (English) hint. */
export function songHint(w: Pick<Workout, 'localized'>, song: SongSlot, lang: Lang): string | undefined {
  return w.localized?.[lang]?.songHints?.[song.id] ?? song.hint;
}
