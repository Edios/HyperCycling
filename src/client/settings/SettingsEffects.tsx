import { useEffect } from 'react';
import { useSettings } from '../data/useSettings';
import { setLang } from '../i18n';

/** Applies stored settings to the whole app; renders nothing. A chosen language wins over the browser's. */
export function SettingsEffects() {
  const { settings, loaded } = useSettings();
  const lang = settings.lang;
  useEffect(() => {
    if (loaded && lang) setLang(lang);
  }, [loaded, lang]);
  return null;
}
