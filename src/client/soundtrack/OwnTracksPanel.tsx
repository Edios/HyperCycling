import { useState, type FormEvent } from 'react';
import { BPM_MAX, BPM_MIN } from '../../domain/bpm-match';
import type { TrackEnergy } from '../../domain/soundtrack-catalog';
import { useT } from '../i18n';
import { Button } from '../ui/Button';
import { Disclosure } from '../ui/Disclosure';
import { Field } from '../ui/Field';
import { Toggle } from '../ui/Toggle';
import { parseYoutubeUrl } from '../youtube/parseYoutubeUrl';
import { addOwnTrack, removeOwnTrack, useOwnTracks, type AddOwnResult } from './own-tracks';
import styles from './SoundtrackWizard.module.css';

const ENERGIES: TrackEnergy[] = [1, 2, 3, 4, 5];

/** "3:45" or "225" as seconds; undefined when it is neither. */
export function parseLength(raw: string): number | undefined {
  const s = raw.trim();
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  if (/^\d{2,4}$/.test(s)) return Number(s);
  return undefined;
}

type FormError = 'errLink' | 'errTitle' | 'errTempo' | 'errLength';
const RESULT_ERROR: Record<
  Exclude<AddOwnResult, 'added'>,
  'errDuplicate' | 'errFull' | 'errSave'
> = {
  duplicate: 'errDuplicate',
  full: 'errFull',
  failed: 'errSave',
};

/**
 * Step 1 of the wizard, "My songs" (Soundtrack Match PR 6): the switch that lets the planner take
 * the rider's own songs, their list, and a form to add one (a YouTube link, a title, a typed
 * tempo; energy and length optional). Nothing is looked up online.
 */
export function OwnTracksPanel({
  use,
  onUseChange,
}: {
  use: boolean;
  onUseChange: (use: boolean) => void;
}) {
  const t = useT();
  const tracks = useOwnTracks((s) => s.tracks);
  const [link, setLink] = useState('');
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [bpm, setBpm] = useState('');
  const [energy, setEnergy] = useState('');
  const [length, setLength] = useState('');
  const [errors, setErrors] = useState<Partial<Record<FormError, true>>>({});
  const [status, setStatus] = useState<{ text: string; error: boolean } | undefined>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const video = parseYoutubeUrl(link);
    const tempo = Number(bpm.replace(',', '.'));
    const len = length.trim() === '' ? undefined : parseLength(length);
    const next: Partial<Record<FormError, true>> = {};
    if (!video) next.errLink = true;
    if (title.trim() === '') next.errTitle = true;
    if (bpm.trim() === '' || !(tempo >= BPM_MIN && tempo <= BPM_MAX)) next.errTempo = true;
    if (length.trim() !== '' && (len === undefined || len < 30 || len > 3600))
      next.errLength = true;
    setErrors(next);
    setStatus(undefined);
    if (!video || Object.keys(next).length > 0) return;
    setBusy(true);
    const result = await addOwnTrack({
      youtubeId: video.videoId,
      title,
      artist,
      bpm: tempo,
      energy: energy === '' ? undefined : (Number(energy) as TrackEnergy),
      durationSec: len,
      startSec: video.startSec > 0 ? video.startSec : undefined,
    });
    setBusy(false);
    if (result === 'added') {
      setStatus({ text: t('soundtrack.own.added', { title: title.trim() }), error: false });
      setLink('');
      setTitle('');
      setArtist('');
      setBpm('');
      setEnergy('');
      setLength('');
      // The first song turns "use my songs" on: that is why it was added.
      if (tracks.length === 0) onUseChange(true);
    } else {
      setStatus({ text: t(`soundtrack.own.${RESULT_ERROR[result]}`), error: true });
    }
  };

  const remove = async (id: string): Promise<void> => {
    setStatus(undefined);
    if (!(await removeOwnTrack(id))) {
      setStatus({ text: t('soundtrack.own.errRemove'), error: true });
    }
  };

  const energyLabel = (n: TrackEnergy): string =>
    t('soundtrack.own.energyLevel', { n, label: t(`soundtrack.own.energy${n}`) });

  return (
    <div className={styles.own}>
      <Disclosure
        title={t('soundtrack.own.title')}
        summary={tracks.length > 0 ? t('soundtrack.own.summary', { n: tracks.length }) : undefined}
        testId="soundtrack-own"
        defaultOpen={use && tracks.length > 0}
      >
        <Toggle
          label={t('soundtrack.own.use')}
          checked={use && tracks.length > 0}
          disabled={tracks.length === 0}
          onChange={onUseChange}
        />
        <p className={styles.help}>{t('soundtrack.own.useHelp')}</p>
        {tracks.length === 0 ? (
          <p className={styles.help}>{t('soundtrack.own.empty')}</p>
        ) : (
          <ul className={styles.ownList} aria-label={t('soundtrack.own.list')}>
            {tracks.map((tr) => (
              <li key={tr.id} data-testid="soundtrack-own-song">
                <span className={styles.ownName}>
                  {tr.artist ? `${tr.artist} – ${tr.title}` : tr.title}
                </span>
                <span className={styles.ownMeta}>
                  {t('soundtrack.own.bpm', { bpm: tr.bpm })}
                  {tr.energy !== undefined ? ` · ${energyLabel(tr.energy)}` : ''}
                </span>
                <Button
                  aria-label={t('soundtrack.own.removeLabel', { title: tr.title })}
                  onClick={() => void remove(tr.id)}
                >
                  {t('soundtrack.own.remove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form className={styles.ownForm} onSubmit={(e) => void submit(e)} noValidate>
          <Field
            label={t('soundtrack.own.link')}
            hint={t('soundtrack.own.linkHint')}
            error={errors.errLink ? t('soundtrack.own.errLink') : undefined}
          >
            {(id) => (
              <input
                id={id}
                type="url"
                inputMode="url"
                autoComplete="off"
                value={link}
                data-testid="soundtrack-own-link"
                onChange={(e) => setLink(e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('soundtrack.own.songTitle')}
            error={errors.errTitle ? t('soundtrack.own.errTitle') : undefined}
          >
            {(id) => (
              <input
                id={id}
                maxLength={120}
                value={title}
                data-testid="soundtrack-own-title"
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('soundtrack.own.artist')}>
            {(id) => (
              <input
                id={id}
                maxLength={120}
                value={artist}
                data-testid="soundtrack-own-artist"
                onChange={(e) => setArtist(e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('soundtrack.own.tempo')}
            hint={t('soundtrack.own.tempoHint')}
            error={
              errors.errTempo
                ? t('soundtrack.own.errTempo', { min: BPM_MIN, max: BPM_MAX })
                : undefined
            }
          >
            {(id) => (
              <input
                id={id}
                inputMode="decimal"
                value={bpm}
                data-testid="soundtrack-own-bpm"
                onChange={(e) => setBpm(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('soundtrack.own.energy')}>
            {(id) => (
              <select
                id={id}
                value={energy}
                data-testid="soundtrack-own-energy"
                onChange={(e) => setEnergy(e.target.value)}
              >
                <option value="">{t('soundtrack.own.energyAuto')}</option>
                {ENERGIES.map((n) => (
                  <option key={n} value={String(n)}>
                    {energyLabel(n)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label={t('soundtrack.own.length')}
            hint={t('soundtrack.own.lengthHint')}
            error={errors.errLength ? t('soundtrack.own.errLength') : undefined}
          >
            {(id) => (
              <input
                id={id}
                inputMode="numeric"
                placeholder="3:45"
                value={length}
                data-testid="soundtrack-own-length"
                onChange={(e) => setLength(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" disabled={busy} data-testid="soundtrack-own-add">
            {t('soundtrack.own.add')}
          </Button>
          {status && (
            <p
              className={status.error ? styles.ownError : styles.help}
              role={status.error ? 'alert' : 'status'}
            >
              {status.text}
            </p>
          )}
        </form>
      </Disclosure>
    </div>
  );
}
