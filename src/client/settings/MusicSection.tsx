import { useCallback, useEffect, useId, useState } from 'react';
import type { SpotifySettings } from '../../domain/settings';
import { useSettings } from '../data/useSettings';
import { useT } from '../i18n';
import { closeDeezerBridge } from '../music/deezer/client';
import { GETSONGBPM_SITE } from '../music/getsongbpm/client';
import { MusicSourceSelect } from '../experience/MusicSourceSelect';
import { useSave } from './save';
import { SongLibraryCard } from './SongLibraryCard';
import { getSharedTagController } from '../music/library/tag-controller';
import {
  beginLogin,
  getLastSpotifyCallbackResult,
  getRedirectUri,
  resolveClientId,
  settingsSpotifyStore,
} from '../music/spotify';
import { hasCredentials } from '../music/spotify/client';
import { spotifyErrorKey } from '../music/spotify/messages';
import type { SpotifyDevice } from '../music/spotify/provider';
import { getSharedSpotifyProvider } from '../music/spotify/shared';
import { Button } from '../ui/Button';
import { Toggle } from '../ui/Toggle';
import styles from './Settings.module.css';

const LOCAL_URI = 'http://127.0.0.1:5175/';
const PAGES_URI = 'https://hypercycling.app/';

type LocationParts = Pick<Location, 'protocol' | 'port' | 'pathname' | 'search' | 'hash'>;

/** The same page on the 127.0.0.1 loopback address (Spotify rejects "localhost"). */
export function loopbackUrl(loc: LocationParts): string {
  const port = loc.port ? `:${loc.port}` : '';
  return `${loc.protocol}//127.0.0.1${port}${loc.pathname}${loc.search}${loc.hash}`;
}

function CopyUri({ label, uri }: { label: string; uri: string }) {
  const t = useT();
  const [note, setNote] = useState<'copied' | 'failed' | undefined>();
  const copy = (): void => {
    try {
      void navigator.clipboard.writeText(uri).then(
        () => setNote('copied'),
        () => setNote('failed'),
      );
    } catch {
      // No clipboard in this context (insecure origin, locked-down browser).
      setNote('failed');
    }
  };
  return (
    <li className={styles.uri}>
      <span className={styles.uriLabel}>{label}</span>
      <code data-testid="redirect-uri">{uri}</code>
      <Button onClick={copy} aria-label={`${t('settings.music.copy')}: ${uri}`}>
        {t('settings.music.copy')}
      </Button>
      <span role="status" className={styles.note}>
        {note === 'copied' && t('settings.music.copied')}
        {note === 'failed' && t('settings.music.copyFailed')}
      </span>
    </li>
  );
}

function useDevices(connected: boolean) {
  const t = useT();
  const [reload, setReload] = useState(0);
  const [done, setDone] = useState<{
    forReload: number;
    devices: SpotifyDevice[];
    error?: string;
  }>({ forReload: -1, devices: [] });
  useEffect(() => {
    if (!connected) return undefined;
    let cancelled = false;
    getSharedSpotifyProvider()
      .listDevices()
      .then(
        (devices) => {
          if (!cancelled) setDone({ forReload: reload, devices });
        },
        (err: unknown) => {
          if (!cancelled) {
            setDone({ forReload: reload, devices: [], error: t(spotifyErrorKey(err)) });
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, [connected, reload, t]);
  const refresh = useCallback(() => setReload((n) => n + 1), []);
  const loading = connected && done.forReload !== reload;
  return {
    loading,
    devices: done.devices,
    ...(done.error && !loading ? { error: done.error } : {}),
    refresh,
  };
}

/** Settings, Music: Spotify Client ID, connection, playback device and setup instructions. */
export function MusicSection() {
  const t = useT();
  const { settings } = useSettings();
  const cfg = settings.spotify;
  const connected = hasCredentials(cfg);
  const envDefault = resolveClientId(undefined);
  const save_ = useSave();
  const gsbpmFieldId = useId();
  const [gsbpmKey, setGsbpmKey] = useState(settings.getSongBpmKey ?? '');
  const clientIdFieldId = useId();
  const deviceFieldId = useId();
  const [clientId, setClientId] = useState(cfg?.clientId ?? '');
  const [message, setMessage] = useState<string | undefined>(() => {
    const last = getLastSpotifyCallbackResult();
    return last.status === 'error' ? t(spotifyErrorKey(last.error)) : undefined;
  });
  const [busy, setBusy] = useState(false);
  const devices = useDevices(connected);
  const onLocalhost = location.hostname === 'localhost' || location.hostname.endsWith('.localhost');

  const current = (): SpotifySettings => settingsSpotifyStore.read() ?? { clientId: '' };

  const save = async (next: SpotifySettings): Promise<boolean> => {
    try {
      await settingsSpotifyStore.write(next);
      return true;
    } catch {
      setMessage(t('settings.music.saveFailed'));
      return false;
    }
  };

  const commitClientId = async (): Promise<boolean> => {
    const value = clientId.trim();
    if (value === (cfg?.clientId ?? '')) return true;
    return save({ ...current(), clientId: value });
  };

  const commitGsbpmKey = (): void => {
    const value = gsbpmKey.trim();
    if (value === (settings.getSongBpmKey ?? '')) return;
    void save_({ getSongBpmKey: value === '' ? undefined : value });
  };

  const toggleDeezer = (on: boolean): void => {
    if (!on) {
      getSharedTagController().pause(); // a running tagging queue must not keep asking Deezer
      closeDeezerBridge(); // drop the sandboxed frame at once
    }
    void save_({ deezerLookup: on });
  };

  const connect = async (): Promise<void> => {
    setMessage(undefined);
    const id = resolveClientId(clientId, envDefault);
    if (!id) {
      setMessage(t('settings.music.clientIdMissing'));
      return;
    }
    setBusy(true);
    try {
      if (!(await commitClientId())) return;
      await beginLogin(id);
    } catch {
      setMessage(t('settings.music.connectFailed'));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    setMessage(undefined);
    setBusy(true);
    try {
      await getSharedSpotifyProvider().disconnect();
    } catch {
      setMessage(t('settings.music.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const pickDevice = (id: string): void => {
    setMessage(undefined);
    const next = { ...current() };
    if (id) next.deviceId = id;
    else delete next.deviceId;
    void save(next);
  };

  const uris: { label: string; uri: string }[] = [
    { label: t('settings.music.uriThis'), uri: getRedirectUri() },
  ];
  for (const [label, uri] of [
    [t('settings.music.uriLocal'), LOCAL_URI],
    [t('settings.music.uriPages'), PAGES_URI],
  ] as const) {
    if (!uris.some((u) => u.uri === uri)) uris.push({ label, uri });
  }

  const selected = cfg?.deviceId ?? '';
  const known = devices.devices.some((d) => d.id === selected);
  const placeholder = envDefault
    ? t('settings.music.clientIdDefault', { id: envDefault })
    : t('settings.music.clientIdPlaceholder');

  return (
    <div className={styles.stack}>
      <p className={styles.lead}>{t('settings.music.intro')}</p>
      <MusicSourceSelect className={styles.note} />

      {onLocalhost && (
        <div role="alert" className={styles.warning} data-testid="localhost-warning">
          <strong>{t('settings.music.localhostTitle')}</strong>
          <span>{t('settings.music.localhostBody')}</span>
          <a href={loopbackUrl(location)} data-testid="loopback-link">
            {t('settings.music.localhostLink')}
          </a>
        </div>
      )}

      <div className={styles.field}>
        <label htmlFor={clientIdFieldId}>{t('settings.music.clientId')}</label>
        <input
          id={clientIdFieldId}
          data-testid="spotify-client-id"
          value={clientId}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          onChange={(e) => setClientId(e.target.value)}
          onBlur={() => void commitClientId()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitClientId();
          }}
        />
        <small className={styles.note}>{t('settings.music.clientIdHint')}</small>
      </div>

      <div className={styles.statusRow}>
        <span>
          {t('settings.music.status')}:{' '}
          <strong data-testid="spotify-status" data-connected={connected}>
            {connected ? t('settings.music.connected') : t('settings.music.notConnected')}
          </strong>
        </span>
        {connected ? (
          <Button
            onClick={() => void disconnect()}
            disabled={busy}
            data-testid="spotify-disconnect"
          >
            {t('settings.music.disconnect')}
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={() => void connect()}
            disabled={busy || onLocalhost}
            data-testid="spotify-connect"
          >
            {t('settings.music.connect')}
          </Button>
        )}
      </div>
      {message && (
        <div role="alert" className={styles.error} data-testid="music-message">
          {message}
        </div>
      )}

      {connected && (
        <div className={styles.field}>
          <label htmlFor={deviceFieldId}>{t('settings.music.device')}</label>
          <div className={styles.deviceRow}>
            <select
              id={deviceFieldId}
              data-testid="spotify-device"
              value={selected}
              onChange={(e) => pickDevice(e.target.value)}
            >
              <option value="">{t('settings.music.deviceAuto')}</option>
              {selected && !known && <option value={selected}>{selected}</option>}
              {devices.devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.type}){d.isActive ? ` · ${t('settings.music.deviceActive')}` : ''}
                </option>
              ))}
            </select>
            <Button onClick={devices.refresh} disabled={devices.loading}>
              {t('settings.music.deviceRefresh')}
            </Button>
          </div>
          <small className={styles.note} role="status">
            {devices.loading && t('settings.music.deviceLoading')}
            {!devices.loading &&
              !devices.error &&
              devices.devices.length === 0 &&
              t('settings.music.deviceNone')}
          </small>
          {devices.error && (
            <small role="alert" className={styles.error}>
              {devices.error}
            </small>
          )}
        </div>
      )}

      <div className={styles.field}>
        <label htmlFor={gsbpmFieldId}>{t('settings.music.gsbpm.key')}</label>
        <input
          id={gsbpmFieldId}
          data-testid="getsongbpm-key"
          type="password"
          value={gsbpmKey}
          autoComplete="off"
          spellCheck={false}
          placeholder={t('settings.music.gsbpm.placeholder')}
          onChange={(e) => setGsbpmKey(e.target.value)}
          onBlur={commitGsbpmKey}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitGsbpmKey();
          }}
        />
        <small className={styles.note}>
          {t('settings.music.gsbpm.hint')}{' '}
          <a href={`${GETSONGBPM_SITE}/api`} target="_blank" rel="noopener noreferrer">
            {t('settings.music.gsbpm.get')}
          </a>
          {' · '}
          <a href={GETSONGBPM_SITE} target="_blank" rel="noopener noreferrer">
            {t('settings.music.gsbpm.link')}
          </a>
        </small>
      </div>

      <div>
        <Toggle
          label={t('settings.music.deezer.label')}
          checked={settings.deezerLookup === true}
          onChange={toggleDeezer}
        />
        <p className={styles.note} data-testid="deezer-lookup-hint">
          {t('settings.music.deezer.hint')}
        </p>
      </div>

      <SongLibraryCard />

      <div className={styles.setup}>
        <h3 className={styles.subTitle}>{t('settings.music.setupTitle')}</h3>
        <ol className={styles.steps}>
          <li>{t('settings.music.setupSteps.dashboard')}</li>
          <li>
            {t('settings.music.setupSteps.redirect')}
            <ul className={styles.uris}>
              {uris.map((u) => (
                <CopyUri key={u.uri} label={u.label} uri={u.uri} />
              ))}
            </ul>
          </li>
          <li>{t('settings.music.setupSteps.api')}</li>
          <li>{t('settings.music.setupSteps.users')}</li>
          <li>{t('settings.music.setupSteps.clientId')}</li>
          <li>{t('settings.music.setupSteps.connect')}</li>
        </ol>
        <p className={styles.note}>{t('settings.music.premiumNote')}</p>
      </div>
    </div>
  );
}
