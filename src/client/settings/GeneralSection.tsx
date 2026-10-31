import { LANGS, type Lang } from '../../domain/lang';
import { useSettings } from '../data/useSettings';
import { getLang, setLang, useT } from '../i18n';
import { Segmented } from '../ui/Segmented';
import { useSave } from './save';
import styles from './Settings.module.css';

/** Each language is named in itself, so it can be found whatever the UI language is. */
const LANG_NAMES: Record<Lang, string> = { pl: 'Polski', en: 'English' };

export function GeneralSection() {
  const t = useT();
  const save = useSave();
  const { settings } = useSettings();
  const lang = getLang();

  const changeLang = (next: Lang): void => {
    const previous = getLang();
    setLang(next);
    void save({ lang: next }).then((ok) => {
      if (!ok) setLang(previous);
    });
  };

  return (
    <div className={styles.stack}>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>{t('settings.general.language')}</span>
        <Segmented
          label={t('settings.general.language')}
          value={lang}
          options={LANGS.map((value) => ({ value, label: LANG_NAMES[value] }))}
          onChange={changeLang}
        />
      </div>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>{t('settings.general.theme')}</span>
        <Segmented
          label={t('settings.general.theme')}
          value={settings.basicTheme}
          options={[
            { value: 'dark', label: t('settings.general.dark') },
            { value: 'light', label: t('settings.general.light') },
          ]}
          onChange={(basicTheme) => void save({ basicTheme })}
        />
        <span className={styles.note}>{t('settings.general.themeHint')}</span>
      </div>
    </div>
  );
}
