import { useRef, useState, type DragEvent } from 'react';
import type { Workout } from '../../domain/workout';
import { useT } from '../i18n';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { importFile, type ImportOutcome } from './import-file';
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

  async function handle(file: File | undefined): Promise<void> {
    if (!file) return;
    setBusy(true);
    try {
      setOutcome(await importFile(file));
    } finally {
      setBusy(false);
    }
  }

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
          {t(outcome.errorKey, { reason: outcome.reason ?? '' })}
        </p>
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
                {outcome.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
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
