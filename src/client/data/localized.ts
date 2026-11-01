import type { Lang, Localized } from '../../domain/lang';

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
