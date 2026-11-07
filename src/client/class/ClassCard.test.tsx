import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../domain/settings';
import { builtinWorkouts } from '../data/builtin';
import { setLang } from '../i18n';
import { ClassCard } from './ClassCard';

const w = builtinWorkouts.find((x) => x.id === 'class-recovery-30');

afterEach(() => setLang('en'));

describe('ClassCard', () => {
  it('lists every song of a built-in class with time and blocks (EN)', () => {
    if (!w) throw new Error('class-recovery-30 missing');
    setLang('en');
    render(
      <ClassCard workout={w} lang="en" table={DEFAULT_SETTINGS.effortTable} name="Recovery" />,
    );
    const songs = screen.getAllByTestId('class-card-song');
    expect(songs).toHaveLength(w.songs?.length ?? 0);
    expect(within(songs[0] as HTMLElement).getByText('Song 1')).toBeInTheDocument();
    expect(screen.getByTestId('class-card')).toHaveTextContent('30:00');
  });

  it('speaks Polish and shows the localized song hint (PL)', () => {
    if (!w) throw new Error('class-recovery-30 missing');
    setLang('pl');
    render(
      <ClassCard workout={w} lang="pl" table={DEFAULT_SETTINGS.effortTable} name="Regeneracja" />,
    );
    expect(screen.getAllByText('Utwór 1').length).toBeGreaterThan(0);
    expect(screen.getByTestId('class-card')).toHaveTextContent('Utwory');
  });

  it('shows the cool-down track on the song that holds the cool-down block', () => {
    if (!w) throw new Error('class-recovery-30 missing');
    const withCd = {
      ...w,
      cooldownTrack: { provider: 'youtube' as const, id: 'abc', title: 'Slow one', startAtSec: 0 },
    };
    render(<ClassCard workout={withCd} lang="en" table={DEFAULT_SETTINGS.effortTable} name="x" />);
    expect(screen.getByTestId('class-card')).toHaveTextContent('Slow one');
  });
});
