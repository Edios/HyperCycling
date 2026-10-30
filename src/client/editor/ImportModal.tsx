import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { Workout } from '../../domain/workout';
import { getRepositories } from '../data/repositories';
import { useT } from '../i18n';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { importFile, readFileText, type ImportOutcome } from './import-file';
import { translateImportError, translateImportWarning, type Translated } from './import-messages';
import styles from './ImportModal.module.css';

export interface ImportModalProps {
  onClose: () => void;
  /** Called with the parsed workout when the user confirms; the caller opens the editor. */
  onOpen: (workout: Workout) => void;
}

/** File picker + drop zone; after parsing shows the warnings and lets the user open the result. */
export function ImportModal({ onClose, onOpen }: ImportModalProps) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome | undefined>();

  const [file, setFile] = useState<File | undefined>();
  const [ftp, setFtp] = useState('');

  // Default the conversion FTP to the player marked "me".
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const repos = await getRepositories();
        const me = (await repos.players.list()).find((p) => p.isMe);
        if (live && me) setFtp(String(me.ftp));
      } catch {
        // no players yet or storage unavailable: the field stays empty
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  async function run(f: File, ftpText: string): Promise<void> {
    setBusy(true);
    const n = Number(ftpText);
    try {
      setOutcome(
        await importFile(
          { name: f.name, size: f.size, text: () => readFileText(f) },
          Number.isFinite(n) && n >= 50 && n <= 600 ? { ftp: n } : {},
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handle(f: File | undefined): Promise<void> {
    if (!f) return;
    setFile(f);
    await run(f, ftp);
  }

  const say = (m: Translated): string => t(m.key, m.params);
  const needFtp =
    outcome !== undefined &&
    !outcome.ok &&
    outcome.errorKey === 'importer.parseFailed' &&
    translateImportError(outcome.reason ?? '').key === 'importer.e.needFtp';

  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    setOver(false);
    void handle(e.dataTransfer.files[0]);
  };

  return (
    <Modal title={t('importer.title')} onClose={onClose}>
      <div
        data-testid="import-drop"
        className={`${styles.drop} ${over ? styles.over : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <p>{t('importer.drop')}</p>
        <Button onClick={() => input.current?.click()} disabled={busy}>
          {t('importer.choose')}
        </Button>
        <input
          ref={input}
          data-testid="import-input"
          type="file"
          accept=".zwo,.erg,.mrc"
          className={styles.hidden}
          tabIndex={-1}
          aria-label={t('importer.choose')}
          onChange={(e) => {
            void handle(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      {outcome && !outcome.ok && (
        <p role="alert" className={styles.error}>
          {outcome.errorKey === 'importer.parseFailed'
            ? say(translateImportError(outcome.reason ?? ''))
            : t(outcome.errorKey, { reason: outcome.reason ?? '' })}
        </p>
      )}
      {needFtp && file && (
        <div className={styles.ftp}>
          <label>
            {t('importer.ftp')}
            <input
              data-testid="import-ftp"
              inputMode="numeric"
              value={ftp}
              onChange={(e) => setFtp(e.target.value)}
            />
          </label>
          <Button disabled={busy} onClick={() => void run(file, ftp)}>
            {t('importer.retry')}
          </Button>
        </div>
      )}
      {outcome?.ok && (
        <div data-testid="import-result">
          <h3 className={styles.sub}>{outcome.workout.name}</h3>
          {outcome.warnings.length === 0 ? (
            <p>{t('importer.cleanBody')}</p>
          ) : (
            <>
              <p>{t('importer.warningsTitle', { n: outcome.warnings.length })}</p>
              <ul className={styles.warnings} data-testid="import-warnings">
                {outcome.warnings.map((w, i) => {
                  const tr = translateImportWarning(w);
                  return <li key={i}>{tr ? say(tr) : w}</li>;
                })}
              </ul>
            </>
          )}
          <div className={styles.actions}>
            <Button onClick={onClose}>{t('importer.cancel')}</Button>
            <Button variant="primary" onClick={() => onOpen(outcome.workout)}>
              {t('importer.open')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
