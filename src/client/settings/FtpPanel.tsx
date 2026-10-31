import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { isValidFtp } from '../../domain/ftp-test';
import { useT } from '../i18n';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { FtpTestGuide } from './FtpTestGuide';
import styles from './Settings.module.css';
import type { MePlayer } from './useMePlayer';

/** "My FTP": the FTP of the player marked as me, edited in place, plus the test guide. */
export function FtpPanel({ mePlayer }: { mePlayer: MePlayer }) {
  const t = useT();
  const { me, loaded, saveFtp } = mePlayer;
  const [draft, setDraft] = useState<string | undefined>();
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const raw = (draft ?? String(me?.ftp ?? '')).trim();
    const ftp = raw === '' ? Number.NaN : Number(raw);
    if (!isValidFtp(ftp)) {
      setError(true);
      setSaved(false);
      return;
    }
    setError(false);
    const ok = await saveFtp(ftp);
    setFailed(!ok);
    setSaved(ok);
    if (ok) setDraft(undefined);
  };

  return (
    <div className={styles.stack}>
      <h3 className={styles.subTitle}>{t('settings.equipment.ftpTitle')}</h3>
      {!loaded ? null : me ? (
        <form className={styles.ftpForm} onSubmit={(e) => void submit(e)} data-testid="my-ftp">
          <Field
            label={t('settings.equipment.ftpValue')}
            hint={t('settings.equipment.ftpFor', { name: me.name })}
            {...(error ? { error: t('settings.equipment.ftpInvalid') } : {})}
          >
            {(id) => (
              <input
                id={id}
                inputMode="numeric"
                value={draft ?? String(me.ftp)}
                aria-invalid={error}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setSaved(false);
                  setError(false);
                }}
              />
            )}
          </Field>
          <Button type="submit">{t('settings.equipment.ftpSave')}</Button>
          <span role="status" className={styles.note}>
            {saved && t('settings.equipment.ftpSaved')}
            {failed && t('settings.saveFailed')}
          </span>
        </form>
      ) : (
        <p className={styles.note} data-testid="my-ftp-none">
          {t('settings.equipment.ftpNoMe')}{' '}
          <Link to="/players" className={styles.link}>
            {t('settings.equipment.ftpPlayersLink')}
          </Link>
        </p>
      )}
      <FtpTestGuide canSave={Boolean(me)} onSave={saveFtp} />
    </div>
  );
}
