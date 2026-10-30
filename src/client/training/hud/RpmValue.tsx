import type { Position } from '../../../domain/workout';
import { useT } from '../../i18n';
import tile from './Tile.module.css';

export interface RpmValueProps {
  rpm?: number;
  position?: Position;
  /** True when the bike does not measure cadence: the number is a target. */
  isTarget: boolean;
  size?: 'xl' | 'lg' | 'md';
}

export function RpmValue({ rpm, position, isTarget, size = 'xl' }: RpmValueProps) {
  const t = useT();
  const parts = [t('training.rpm')];
  if (position) parts.push(t(position === 'standing' ? 'training.standing' : 'training.seated'));
  if (isTarget) parts.push(t('training.target'));
  return (
    <div data-testid="rpm-value" className={`${tile.tile} ${tile[size]}`}>
      <div className={tile.label}>{t('training.cadence')}</div>
      <div className={tile.value}>{rpm === undefined ? '—' : Math.round(rpm)}</div>
      <div className={tile.sub}>{parts.join(' · ')}</div>
    </div>
  );
}
