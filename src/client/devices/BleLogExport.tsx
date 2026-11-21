import { useState } from 'react';
import { triggerDownload, type DownloadFn } from '../data/import-export';
import { useT } from '../i18n';
import { Button } from '../ui/Button';
import { Toast } from '../ui/Toast';
import type { BleLog } from './ble-log';
import { buildBleLogExport } from './ble-log-export';
import styles from './DevicesPanel.module.css';

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? 'dev';

type Notice = 'copied' | 'copyFailed' | 'saved';

/** Copy or save the Bluetooth log, so a problem seen on a phone can be sent for diagnosis. */
export function BleLogExport({
  log,
  download = triggerDownload,
}: {
  log: BleLog;
  /** Test seam. */
  download?: DownloadFn;
}) {
  const t = useT();
  const [notice, setNotice] = useState<{ kind: Notice; id: number } | null>(null);
  const say = (kind: Notice): void => setNotice({ kind, id: Date.now() });

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(buildBleLogExport(log, APP_VERSION, new Date()).text);
      say('copied');
    } catch {
      say('copyFailed');
    }
  };
  const save = async (): Promise<void> => {
    const { text, fileName } = buildBleLogExport(log, APP_VERSION, new Date());
    await download(new Blob([text], { type: 'text/plain;charset=utf-8' }), fileName);
    say('saved');
  };

  return (
    <section className={styles.logExport} aria-labelledby="ble-log-title" data-testid="ble-log">
      <h4 id="ble-log-title" className={styles.logTitle}>
        {t('devices.log.title')}
      </h4>
      <p className={styles.logHint}>{t('devices.log.privacy')}</p>
      <div className={styles.logActions}>
        <Button className={styles.btn} onClick={() => void copy()} data-testid="ble-log-copy">
          {t('devices.log.copy')}
        </Button>
        <Button className={styles.btn} onClick={() => void save()} data-testid="ble-log-save">
          {t('devices.log.save')}
        </Button>
      </div>
      {notice && (
        <Toast
          key={notice.id}
          message={t(`devices.log.${notice.kind}`)}
          onClose={() => setNotice(null)}
        />
      )}
    </section>
  );
}
