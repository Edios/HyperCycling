import { useT, type MessageKey } from '../i18n';
import { Button } from '../ui/Button';
import { Icon, type IconName } from '../ui/Icon';
import { BleLogExport } from './BleLogExport';
import type { DeviceKind, DeviceSlot, DeviceStore } from './device-store';
import styles from './DevicesPanel.module.css';
import { UNSUPPORTED_MESSAGE } from './support';
import {
  useAdapterAvailable,
  useDeviceStore,
  useDevicesState,
  useHeartRateReading,
  useTrainerReading,
} from './useDevices';

export interface DevicesPanelProps {
  /** `compact`: rows only (setup screen). `full`: intro, rows and help (settings). */
  variant: 'compact' | 'full';
  /** Offer the trainer row (not for a bike with a plain knob and no meter). */
  showTrainer: boolean;
  /** Show live watts (only for a bike that has a power meter or is a smart trainer). */
  showWatts: boolean;
}

const ICON: Record<DeviceKind, IconName> = { trainer: 'trainer', hr: 'heart' };
const TITLE: Record<DeviceKind, MessageKey> = { trainer: 'devices.trainer', hr: 'devices.hr' };
const CONNECT: Record<DeviceKind, MessageKey> = {
  trainer: 'devices.connectTrainer',
  hr: 'devices.connectHr',
};

function statusKey(slot: DeviceSlot): MessageKey {
  if (slot.status === 'disconnected') {
    if (slot.reason === 'lost') return 'devices.status.lost';
    if (slot.reason === 'failed') return 'devices.status.failed';
    return 'devices.status.user';
  }
  return `devices.status.${slot.status}`;
}

/** Bluetooth trainer and heart rate strap: connect, status, live values, disconnect. */
export function DevicesPanel({ variant, showTrainer, showWatts }: DevicesPanelProps) {
  const t = useT();
  const store = useDeviceStore();
  const state = useDevicesState(store);
  const adapter = useAdapterAvailable(store, state.supported);
  const full = variant === 'full';

  if (!state.supported) {
    // The setup screen stays quiet in a browser without Bluetooth (nothing to connect there);
    // Settings explains why and what to use instead.
    if (!full) return null;
    return (
      <div className={`${styles.panel} ${full ? styles.full : ''}`} data-testid="devices">
        <p className={styles.unsupported} role="status" data-testid="devices-unsupported">
          <Icon name="bluetooth" size={18} />
          <span>{t(UNSUPPORTED_MESSAGE[state.unsupportedReason ?? 'no-api'])}</span>
        </p>
      </div>
    );
  }

  const kinds: DeviceKind[] = showTrainer ? ['trainer', 'hr'] : ['hr'];
  return (
    <div className={`${styles.panel} ${full ? styles.full : ''}`} data-testid="devices">
      {full && <p className={styles.intro}>{t('devices.intro')}</p>}
      <ul className={styles.rows}>
        {kinds.map((kind) => (
          <DeviceRow
            key={kind}
            kind={kind}
            store={store}
            slot={state[kind]}
            showWatts={showWatts}
            compact={!full}
          />
        ))}
      </ul>
      {!adapter && (
        <p className={styles.warn} role="status" data-testid="devices-adapter">
          <Icon name="warning" size={16} />
          <span>{t('devices.adapterOff')}</span>
        </p>
      )}
      {full && (
        <details className={styles.help}>
          <summary>{t('devices.help.title')}</summary>
          <ul>
            <li>{t('devices.help.wake')}</li>
            <li>{t('devices.help.otherApps')}</li>
            <li>{t('devices.help.ftms')}</li>
            <li>{t('devices.help.keepOpen')}</li>
          </ul>
        </details>
      )}
      {full && <BleLogExport log={store.log} />}
    </div>
  );
}

function DeviceRow({
  kind,
  store,
  slot,
  showWatts,
  compact,
}: {
  kind: DeviceKind;
  store: DeviceStore;
  slot: DeviceSlot;
  showWatts: boolean;
  compact: boolean;
}) {
  const t = useT();
  const state = useDevicesState(store);
  const trainer = useTrainerReading(store, state);
  const hr = useHeartRateReading(store, state);

  const connected = slot.status === 'connected';
  const busy = slot.status === 'connecting' || slot.status === 'reconnecting';
  const lost = slot.status === 'disconnected' && slot.reason === 'lost';
  const problem = slot.status === 'disconnected' && slot.reason !== 'user';

  const live: string[] = [];
  if (kind === 'trainer' && trainer) {
    const { powerW, cadenceRpm } = trainer.data;
    if (showWatts && powerW !== undefined) live.push(t('devices.live.power', { watts: powerW }));
    if (cadenceRpm !== undefined) {
      live.push(t('devices.live.cadence', { rpm: Math.round(cadenceRpm) }));
    }
  }
  if (kind === 'hr' && hr) {
    live.push(
      hr.measurement.contact === 'none'
        ? t('devices.live.noContact')
        : t('devices.live.bpm', { bpm: hr.measurement.bpm }),
    );
  }

  const title = connected && slot.name ? slot.name : t(TITLE[kind]);
  const stateText =
    slot.status === 'none' ? (compact ? '' : t('devices.status.none')) : t(statusKey(slot));
  const connect = () => void store.connect(kind);

  return (
    <li
      className={`${styles.row} ${compact ? styles.compact : ''}`}
      data-testid={`device-${kind}`}
      data-status={slot.status}
    >
      <span className={`${styles.icon} ${connected ? styles.iconOn : ''}`}>
        <Icon name={ICON[kind]} size={compact ? 20 : 24} />
      </span>
      <div className={styles.text}>
        <span className={styles.title}>
          {title}
          {connected && slot.name && <span className={styles.kind}>{t(TITLE[kind])}</span>}
        </span>
        <span className={`${styles.status} ${problem ? styles.problem : ''}`}>
          {/* Only state changes are announced; live values update every second and stay quiet. */}
          <span role="status" aria-live="polite" data-testid={`device-${kind}-state`}>
            {stateText}
          </span>
          {live.length > 0 && (
            <b className={styles.live} aria-live="off" data-testid={`device-${kind}-live`}>
              {live.join(' · ')}
            </b>
          )}
        </span>
      </div>
      <div className={styles.actions}>
        {connected || busy ? (
          <Button className={styles.btn} onClick={() => store.disconnect(kind)}>
            {t('devices.disconnect')}
          </Button>
        ) : lost ? (
          <>
            <Button className={styles.btn} onClick={() => void store.reconnect(kind)}>
              {t('devices.reconnect')}
            </Button>
            {!compact && (
              <Button className={styles.btn} onClick={connect}>
                {t('devices.chooseOther')}
              </Button>
            )}
          </>
        ) : (
          <Button className={styles.btn} onClick={connect} data-testid={`connect-${kind}`}>
            <Icon name="bluetooth" size={18} />
            {t(CONNECT[kind])}
          </Button>
        )}
      </div>
    </li>
  );
}
