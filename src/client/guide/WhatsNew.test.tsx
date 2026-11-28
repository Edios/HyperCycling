import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { latestPr } from '../../shared/changelog';
import { setLang } from '../i18n';
import { NewDot } from './NewDot';
import { WhatsNew } from './WhatsNew';
import { changelog, changelogPl, hasUnseen, splitDays, WHATS_NEW_KEY } from './whats-new';

const page = () =>
  render(
    <MemoryRouter>
      <WhatsNew />
    </MemoryRouter>,
  );

describe("What's new", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => setLang('en'));

  it('shows the dot until the page is opened, then never again for the same changes', () => {
    render(<NewDot />);
    expect(screen.getByTestId('whats-new-dot')).toBeTruthy();
    expect(hasUnseen()).toBe(true);
    act(() => {
      page();
    });
    expect(localStorage.getItem(WHATS_NEW_KEY)).toBe(String(latestPr(changelog)));
    expect(screen.queryByTestId('whats-new-dot')).toBeNull();
  });

  it('shows the dot again when a newer change ships', () => {
    localStorage.setItem(WHATS_NEW_KEY, String(latestPr(changelog) - 1));
    render(<NewDot />);
    expect(screen.getByTestId('whats-new-dot')).toBeTruthy();
  });

  it('writes the recent changes in Polish and folds the older ones (in English)', () => {
    setLang('pl');
    page();
    expect(screen.getByRole('heading', { level: 1, name: 'Co nowego' })).toBeTruthy();
    const [pr, text] = Object.entries(changelogPl)[0]!;
    expect(screen.getByText(text), pr).toBeTruthy();
    expect(screen.getByTestId('whats-new-older').hasAttribute('open')).toBe(false);
    expect(screen.getByTestId('whats-new-version').textContent).toMatch(/^Wersja /);
  });

  it('shows the English titles in English', () => {
    page();
    expect(screen.getByRole('heading', { level: 1, name: "What's new" })).toBeTruthy();
    expect(screen.getByText(changelog.entries[0]!.title)).toBeTruthy();
  });

  it('keeps changes newer than the Polish texts open, in English', () => {
    const days = [
      {
        date: '2026-12-02',
        entries: [{ pr: 9, date: '2026-12-02', type: 'fix' as const, title: 'x' }],
      },
      {
        date: '2026-12-01',
        entries: [{ pr: 8, date: '2026-12-01', type: 'fix' as const, title: 'y' }],
      },
      {
        date: '2026-11-30',
        entries: [{ pr: 7, date: '2026-11-30', type: 'fix' as const, title: 'z' }],
      },
    ];
    const { recent, older } = splitDays(days, { '8': 'tekst' });
    expect(recent.map((d) => d.date)).toEqual(['2026-12-02', '2026-12-01']);
    expect(older.map((d) => d.date)).toEqual(['2026-11-30']);
  });
});
