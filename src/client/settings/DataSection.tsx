import { useEffect, useRef, useState } from 'react';
import { getRepositories } from '../data/repositories';
import {
  exportFileName,
  exportToFile,
  importFromFile,
  triggerDownload,
  type DownloadFn,
  type ImportResult,
} from '../data/import-export';
import { useSettings } from '../data/useSettings';
import { useT, type MessageKey } from '../i18n';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { useSave } from './save';
import styles from './Settings.module.css';

type Location = { kind: 'server'; path: string } | { kind: 'browser' } | { kind: 'unknown' };

/** Where the data is stored: the database file on the local server, or the browser on Pages. */
function useLocation(): Location | undefined {
  const browser = import.meta.env.VITE_STORAGE === 'indexeddb';
  const [where, setWhere] = useState<Location | undefined>();
  useEffect(() => {
    if (browser) return undefined;
    let cancelled = false;
    fetch('/api/health')
      .then((r) => r.json() as Promise<{ dbPath?: unknown }>)
      .then((body) => (typeof body.dbPath === 'string' ? body.dbPath : undefined))
      .catch(() => undefined)
      .then((path) => {
        if (!cancelled) setWhere(path ? { kind: 'server', path } : { kind: 'unknown' });
      });
    return () => {
      cancelled = true;
    };
  }, [browser]);
  return browser ? { kind: 'browser' } : where;
}

const REASON_KEY: Record<Extract<ImportResult, { ok: false }>['reason'], MessageKey> = {
  notJson: 'settings.data.reason.notJson',
  wrongApp: 'settings.data.reason.wrongApp',
  unsupportedVersion: 'settings.data.reason.unsupportedVersion',
  invalid: 'settings.data.reason.invalid',
  failed: 'settings.data.reason.failed',
};

interface DataSectionProps {
  /** Test seams. */
  download?: DownloadFn;
  reload?: () => void;
}

export function DataSection({
  download = triggerDownload,
  reload = () => window.location.reload(),
}: DataSectionProps) {
  const t = useT();
  const save = useSave();
  const { settings } = useSettings();
  const where = useLocation();
  const picker = useRef<HTMLInputElement>(null);
  const [exportError, setExportError] = useState(false);
  const [pending, setPending] = useState<File | undefined>();
  const [result, setResult] = useState<ImportResult | undefined>();
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    if (!result?.ok) return undefined;
    const id = setTimeout(reload, 1500);
    return () => clearTimeout(id);
  }, [result, reload]);

  const doExport = async (): Promise<void> => {
    setExportError(false);
    try {
      const blob = await exportToFile(await getRepositories());
      await download(blob, exportFileName(new Date()));
    } catch (err) {
      console.warn('Export failed', err);
      setExportError(true);
    }
  };

  const doImport = async (file: File): Promise<void> => {
    setPending(undefined);
    try {
      setResult(await importFromFile(await getRepositories(), file));
    } catch (err) {
      setResult({
        ok: false,
        reason: 'failed',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const clearYoutube = async (): Promise<void> => {
    const ok = await save({ recentYoutubeUrls: [] });
    setCleared(ok);
  };

  return (
    <div className={styles.stack}>
      <div className={styles.dataBlock}>
        <h3 className={styles.subTitle}>{t('settings.data.exportTitle')}</h3>
        <p className={styles.note}>{t('settings.data.exportBody')}</p>
        <div>
          <Button onClick={() => void doExport()}>{t('settings.data.exportButton')}</Button>
        </div>
        {exportError && (
          <p role="alert" className={styles.error}>
            {t('settings.data.exportFailed')}
          </p>
        )}
      </div>

      <div className={styles.dataBlock}>
        <h3 className={styles.subTitle}>{t('settings.data.importTitle')}</h3>
        <p className={styles.note}>{t('settings.data.importBody')}</p>
        <div>
          <input
            ref={picker}
            type="file"
            accept="application/json,.json"
            className={styles.srOnly}
            data-testid="import-file"
            aria-label={t('settings.data.importButton')}
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) {
                setResult(undefined);
                setPending(file);
              }
            }}
          />
          <Button onClick={() => picker.current?.click()}>{t('settings.data.importButton')}</Button>
        </div>
        {result &&
          (result.ok ? (
            <p role="status" className={styles.note} data-testid="import-result">
              {t('settings.data.importOk')}
            </p>
          ) : (
            <p role="alert" className={styles.error} data-testid="import-result">
              {t('settings.data.importFailed')}{' '}
              {t(REASON_KEY[result.reason], { details: result.details ?? '' })}
            </p>
          ))}
      </div>

      <div className={styles.dataBlock}>
        <h3 className={styles.subTitle}>{t('settings.data.locationTitle')}</h3>
        <p className={styles.note} data-testid="data-location">
          {where?.kind === 'server' && t('settings.data.locationServer', { path: where.path })}
          {where?.kind === 'browser' && t('settings.data.locationBrowser')}
          {where?.kind === 'unknown' && t('settings.data.locationUnknown')}
        </p>
      </div>

      <div className={styles.dataBlock}>
        <h3 className={styles.subTitle}>{t('settings.data.youtubeTitle')}</h3>
        <p className={styles.note}>
          {t('settings.data.youtubeCount', { n: settings.recentYoutubeUrls.length })}
        </p>
        <div>
          <Button
            disabled={settings.recentYoutubeUrls.length === 0}
            onClick={() => void clearYoutube()}
          >
            {t('settings.data.youtubeClear')}
          </Button>
        </div>
        <span role="status" className={styles.note}>
          {cleared && settings.recentYoutubeUrls.length === 0 && t('settings.data.youtubeCleared')}
        </span>
      </div>

      {pending && (
        <Modal title={t('settings.data.importConfirmTitle')} onClose={() => setPending(undefined)}>
          <p>{t('settings.data.importConfirmBody', { file: pending.name })}</p>
          <div className={styles.dialogActions}>
            <Button onClick={() => setPending(undefined)}>{t('settings.data.cancel')}</Button>
            <Button variant="primary" onClick={() => void doImport(pending)}>
              {t('settings.data.importConfirmYes')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
