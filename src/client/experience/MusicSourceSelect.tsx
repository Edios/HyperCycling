import { useId } from 'react';
import { MUSIC_SOURCES, type MusicSource } from '../../domain/music-chain';
import { useT, type MessageKey } from '../i18n';
import { setMusicSource, useMusicSource } from '../music/music-source';

const LABEL: Record<MusicSource, MessageKey> = {
  youtube: 'experience.check.source.youtube',
  spotify: 'experience.check.source.spotify',
  auto: 'experience.check.source.auto',
};

/** "Music source": YouTube (default), Spotify with YouTube behind it, or Auto. */
export function MusicSourceSelect({ className }: { className?: string }) {
  const t = useT();
  const id = useId();
  const source = useMusicSource();
  return (
    <label htmlFor={id} className={className}>
      <span>{t('experience.check.source.label')}</span>{' '}
      <select
        id={id}
        value={source}
        data-testid="music-source"
        onChange={(e) => setMusicSource(e.target.value as MusicSource)}
      >
        {MUSIC_SOURCES.map((s) => (
          <option key={s} value={s}>
            {t(LABEL[s])}
          </option>
        ))}
      </select>
    </label>
  );
}
