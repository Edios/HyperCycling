import { useCallback } from 'react';
import { useLang, useT } from '../i18n';

/** "7 songs" with the plural form of the current language (Polish has one, few and many). */
export function useSongsLabel(): (n: number) => string {
  const t = useT();
  const [lang] = useLang();
  return useCallback(
    (n: number) => {
      const cat = new Intl.PluralRules(lang).select(n);
      const key =
        cat === 'one'
          ? 'experience.songsOne'
          : cat === 'few'
            ? 'experience.songsFew'
            : cat === 'many'
              ? 'experience.songsMany'
              : 'experience.songsOther';
      return t(key, { n });
    },
    [t, lang],
  );
}
