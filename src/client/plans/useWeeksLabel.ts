import { useCallback } from 'react';
import { useLang, useT } from '../i18n';

/** "8 weeks" with the plural form of the current language (Polish has one, few and many). */
export function useWeeksLabel(): (n: number) => string {
  const t = useT();
  const [lang] = useLang();
  return useCallback(
    (n: number) => {
      const cat = new Intl.PluralRules(lang).select(n);
      const key =
        cat === 'one'
          ? 'plans.weeksOne'
          : cat === 'few'
            ? 'plans.weeksFew'
            : cat === 'many'
              ? 'plans.weeksMany'
              : 'plans.weeksOther';
      return t(key, { n });
    },
    [t, lang],
  );
}
