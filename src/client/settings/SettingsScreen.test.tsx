import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportBundle } from '../../domain/export-bundle';
import type { Player } from '../../domain/player';
import type { Settings } from '../../domain/settings';

const db = vi.hoisted(() => ({
  settings: undefined as Settings | undefined,
  players: [] as Player[],
  failSettingsPut: false,
  replaced: undefined as ExportBundle | undefined,
}));

vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      settings: {
        get: () => Promise.resolve(db.settings),
        put: (s: Settings) => {
          if (db.failSettingsPut) return Promise.reject(new Error('disk full'));
          db.settings = s;
          return Promise.resolve();
        },
      },
      players: {
        list: () => Promise.resolve(db.players),
        put: (p: Player) => {
          db.players = db.players.map((x) => (x.id === p.id ? p : x));
          return Promise.resolve();
        },
      },
      exportAll: () =>
        Promise.resolve({
          app: 'spinning-tutor',
          schemaVersion: 1,
          exportedAt: '2026-10-31T10:00:00.000Z',
          workouts: [],
          players: db.players,
          planProgress: [],
          sessionLogs: [],
          settings: db.settings ?? null,
        }),
      replaceAll: (b: ExportBundle) => {
        db.replaced = b;
        return Promise.resolve();
      },
    }),
}));

import { DEFAULT_EFFORT_TABLE } from '../../domain/effort';
import { DEFAULT_SETTINGS } from '../../domain/settings';
import { resetSettingsForTests } from '../data/useSettings';
import { setLang } from '../i18n';
import { resetSharedSpotifyProviderForTests } from '../music/spotify/shared';
import { DataSection } from './DataSection';
import { SettingsEffects } from './SettingsEffects';
import { SettingsScreen } from './SettingsScreen';

function renderScreen() {
  return render(
    <MemoryRouter>
      <SettingsEffects />
      <SettingsScreen />
    </MemoryRouter>,
  );
}

const section = (id: string) => screen.findByTestId(`settings-${id}`);

beforeEach(() => {
  db.settings = undefined;
  db.players = [];
  db.failSettingsPut = false;
  db.replaced = undefined;
  resetSettingsForTests();
  resetSharedSpotifyProviderForTests();
  setLang('en');
});

afterEach(() => {
  setLang('en');
  vi.restoreAllMocks();
});

describe('Settings screen structure', () => {
  it('has a nav entry and a section for each of the six parts', async () => {
    renderScreen();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    for (const name of ['General', 'Equipment & FTP', 'Training', 'Zones', 'Music', 'Data']) {
      expect(within(nav).getByRole('button', { name })).toBeInTheDocument();
    }
    for (const id of ['general', 'equipment', 'training', 'zones', 'music', 'data']) {
      expect(await section(id)).toBeInTheDocument();
    }
  });

  it('scrolls to a section from the nav', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderScreen();
    await section('general');
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Zones' }));
    expect(scroll).toHaveBeenCalled();
    expect(within(nav).getByRole('button', { name: 'Zones' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });
});

describe('General', () => {
  it('links to the help pages next to the app', async () => {
    renderScreen();
    const general = await section('general');
    const link = within(general).getByRole('link', { name: 'Help and guides' });
    expect(link).toHaveAttribute('href', `${import.meta.env.BASE_URL}docs/`);
  });

  it('switches the language at once, saves it and sets <html lang>', async () => {
    renderScreen();
    const general = await section('general');
    fireEvent.click(within(general).getByRole('radio', { name: 'Polski' }));
    expect(document.documentElement.lang).toBe('pl');
    expect(screen.getByRole('heading', { level: 1, name: 'Ustawienia' })).toBeInTheDocument();
    await waitFor(() => expect(db.settings?.lang).toBe('pl'));
  });

  it('applies a stored language when the app loads', async () => {
    db.settings = { ...DEFAULT_SETTINGS, lang: 'pl' };
    renderScreen();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ustawienia' }),
    ).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('pl');
  });

  it('saves the basic theme', async () => {
    renderScreen();
    const general = await section('general');
    fireEvent.click(within(general).getByRole('radio', { name: 'Light' }));
    await waitFor(() => expect(db.settings?.basicTheme).toBe('light'));
  });

  it('shows an error toast and goes back to the old language when saving fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    renderScreen();
    const general = await section('general');
    db.failSettingsPut = true;
    fireEvent.click(within(general).getByRole('radio', { name: 'Polski' }));
    expect(await screen.findByText('Could not save the setting. Try again.')).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.lang).toBe('en'));
  });
});

describe('Equipment & FTP', () => {
  it('saves the three bike toggles', async () => {
    renderScreen();
    const eq = await section('equipment');
    fireEvent.click(within(eq).getByRole('switch', { name: 'Bike shows watts' }));
    await waitFor(() => expect(db.settings?.equipment.showsWatts).toBe(false));
    fireEvent.click(within(eq).getByRole('switch', { name: 'Bike shows cadence' }));
    await waitFor(() => expect(db.settings?.equipment.showsCadence).toBe(false));
    fireEvent.click(within(eq).getByRole('switch', { name: 'Hide the cadence tile' }));
    await waitFor(() => expect(db.settings?.equipment.hideRpmTile).toBe(true));
    expect(db.settings?.equipment.showsWatts).toBe(false);
  });

  it('points to Players when nobody is marked as me', async () => {
    db.players = [{ id: 'a', name: 'Ola', ftp: 200 }];
    renderScreen();
    expect(await screen.findByTestId('my-ftp-none')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Players' })).toHaveAttribute('href', '/players');
  });

  it('edits the FTP of the me player, rejecting values outside 50..600', async () => {
    db.players = [
      { id: 'a', name: 'Ola', ftp: 200 },
      { id: 'b', name: 'Marek', ftp: 250, isMe: true },
    ];
    renderScreen();
    const form = await screen.findByTestId('my-ftp');
    const input = within(form).getByLabelText('FTP (W)');
    expect(input).toHaveValue('250');
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save FTP' }));
    expect(
      await within(form).findByText('FTP must be a whole number from 50 to 600'),
    ).toBeInTheDocument();
    expect(db.players.find((p) => p.id === 'b')?.ftp).toBe(250);

    fireEvent.change(input, { target: { value: '265' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save FTP' }));
    await waitFor(() => expect(db.players.find((p) => p.id === 'b')?.ftp).toBe(265));
    expect(db.players.find((p) => p.id === 'a')?.ftp).toBe(200);
    expect(await within(form).findByText('FTP saved')).toBeInTheDocument();
  });
});

describe('FTP test guide', () => {
  async function openGuide() {
    renderScreen();
    const guide = await screen.findByTestId('ftp-guide');
    fireEvent.click(within(guide).getByRole('button', { name: /FTP test guide/ }));
    return guide;
  }

  it('is collapsed until opened', async () => {
    renderScreen();
    const guide = await screen.findByTestId('ftp-guide');
    const toggle = within(guide).getByRole('button', { name: /FTP test guide/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('explains each test with its formula and links the ramp test to its workout', async () => {
    const guide = await openGuide();
    const radios = within(guide).getAllByRole('radio');
    expect(radios[0]).toHaveAccessibleName('20-minute test');
    expect(radios[0]).toBeChecked();
    expect(within(guide).getByTestId('ftp-recommended')).toHaveTextContent("don't know your FTP");
    expect(within(guide).getByTestId('ftp-recommended')).toHaveTextContent('8 out of 10');
    expect(within(guide).getByText('FTP = 95 % of the 20-minute average power')).toBeVisible();
    expect(within(guide).getByTestId('ftp-test-start')).toHaveAttribute(
      'href',
      '/setup/ftp-test-20',
    );
    fireEvent.click(within(guide).getByRole('radio', { name: 'Ramp test' }));
    expect(within(guide).queryByTestId('ftp-recommended')).not.toBeInTheDocument();
    expect(within(guide).getByText('FTP = 75 % of best 1-minute power')).toBeVisible();
    expect(within(guide).getByTestId('ftp-test-start')).toHaveAttribute('href', '/setup/ramp-test');
    fireEvent.click(within(guide).getByRole('radio', { name: '2 x 8-minute test' }));
    expect(within(guide).getByText('FTP = 90 % of the average of the two efforts')).toBeVisible();
    expect(within(guide).getAllByRole('listitem')).toHaveLength(3);
  });

  it('computes the FTP and saves it to the me player', async () => {
    db.players = [{ id: 'b', name: 'Marek', ftp: 250, isMe: true }];
    const guide = await openGuide();
    await screen.findByTestId('my-ftp');
    fireEvent.click(within(guide).getByRole('radio', { name: 'Ramp test' }));
    fireEvent.change(within(guide).getByLabelText('Best 1-minute power (W)'), {
      target: { value: '320' },
    });
    expect(within(guide).getByTestId('ftp-result')).toHaveTextContent('Your FTP: 240 W');
    fireEvent.click(within(guide).getByRole('button', { name: 'Save as my FTP' }));
    await waitFor(() => expect(db.players[0]?.ftp).toBe(240));
  });

  it('averages the two 8-minute efforts', async () => {
    const guide = await openGuide();
    fireEvent.click(within(guide).getByRole('radio', { name: '2 x 8-minute test' }));
    fireEvent.change(within(guide).getByLabelText('Effort 1 average power (W)'), {
      target: { value: '270' },
    });
    fireEvent.change(within(guide).getByLabelText('Effort 2 average power (W)'), {
      target: { value: '260' },
    });
    expect(within(guide).getByTestId('ftp-result')).toHaveTextContent('Your FTP: 239 W');
  });

  it('cannot save without a me player', async () => {
    const guide = await openGuide();
    await screen.findByTestId('my-ftp-none');
    fireEvent.click(within(guide).getByRole('radio', { name: 'Ramp test' }));
    fireEvent.change(within(guide).getByLabelText('Best 1-minute power (W)'), {
      target: { value: '320' },
    });
    expect(within(guide).getByRole('button', { name: 'Save as my FTP' })).toBeDisabled();
  });
});

describe('Training', () => {
  it('saves sounds, coach and Hyperride quality', async () => {
    renderScreen();
    const tr = await section('training');
    fireEvent.click(within(tr).getByRole('switch', { name: 'Sounds' }));
    await waitFor(() => expect(db.settings?.sounds).toBe(false));
    fireEvent.click(within(tr).getByRole('switch', { name: 'Coach messages' }));
    await waitFor(() => expect(db.settings?.coach).toBe(false));
    fireEvent.click(within(tr).getByRole('radio', { name: 'Low' }));
    await waitFor(() => expect(db.settings?.hyperrideQuality).toBe('low'));
  });

  it('saves the Hyperride world', async () => {
    renderScreen();
    const tr = await section('training');
    expect(within(tr).getByRole('radio', { name: 'Neon tunnel' })).toBeChecked();
    fireEvent.click(within(tr).getByRole('radio', { name: 'Road' }));
    await waitFor(() => expect(db.settings?.hyperrideWorld).toBe('road'));
  });

  it('saves the effects intensity as 0..1', async () => {
    renderScreen();
    const tr = await section('training');
    fireEvent.change(within(tr).getByLabelText('Effects intensity'), { target: { value: '40' } });
    await waitFor(() => expect(db.settings?.effectsIntensity).toBe(0.4));
    expect(within(tr).getByText('40%')).toBeInTheDocument();
  });

  it('creates lastSession from defaults when choosing a default background and layout', async () => {
    renderScreen();
    const tr = await section('training');
    fireEvent.click(within(tr).getByRole('radio', { name: 'Hyperride' }));
    await waitFor(() => expect(db.settings?.lastSession?.background).toBe('hyperride'));
    expect(db.settings?.lastSession?.hud).toBe('immersive');
    expect(db.settings?.lastSession?.playerIds).toEqual([]);
    fireEvent.click(within(tr).getByRole('radio', { name: 'Column' }));
    await waitFor(() => expect(db.settings?.lastSession?.hud).toBe('column'));
  });

  it('keeps the rest of an existing lastSession', async () => {
    db.settings = {
      ...DEFAULT_SETTINGS,
      lastSession: { background: 'basic', hud: 'solo', playerIds: ['a'], music: true },
    };
    renderScreen();
    const tr = await section('training');
    fireEvent.click(await within(tr).findByRole('radio', { name: 'YouTube video' }));
    await waitFor(() => expect(db.settings?.lastSession?.background).toBe('youtube'));
    expect(db.settings?.lastSession).toMatchObject({ playerIds: ['a'], music: true });
  });
});

describe('Zones', () => {
  const pctInput = async (level: number) =>
    (await screen.findByLabelText(`% FTP for level ${level}`)) as HTMLInputElement;

  it('lists the 10 levels with their % FTP', async () => {
    renderScreen();
    const zones = await section('zones');
    expect(within(zones).getAllByTestId('zone-row')).toHaveLength(10);
    expect(await pctInput(8)).toHaveValue('100');
    expect(within(zones).getByText('Threshold')).toBeInTheDocument();
  });

  it('saves a valid edit', async () => {
    renderScreen();
    fireEvent.change(await pctInput(1), { target: { value: '40' } });
    await waitFor(() => expect(db.settings?.effortTable[0]?.ftpPct).toBe(40));
    expect(db.settings?.effortTable[1]?.ftpPct).toBe(55);
  });

  it('shows an inline error and does not save a table that is not increasing', async () => {
    renderScreen();
    const zones = await section('zones');
    const input = await pctInput(5);
    fireEvent.change(input, { target: { value: '70' } });
    expect(await within(zones).findByText('Must be higher than the level below.')).toBeVisible();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(db.settings).toBeUndefined();
  });

  it('rejects a value out of range and empty input', async () => {
    renderScreen();
    const zones = await section('zones');
    fireEvent.change(await pctInput(10), { target: { value: '500' } });
    expect(await within(zones).findByText('Use a value from 20 to 200.')).toBeVisible();
    fireEvent.change(await pctInput(10), { target: { value: '' } });
    expect(within(zones).getByText('Use a value from 20 to 200.')).toBeVisible();
    expect(db.settings).toBeUndefined();
  });

  it('restores defaults only after confirmation', async () => {
    db.settings = {
      ...DEFAULT_SETTINGS,
      effortTable: DEFAULT_EFFORT_TABLE.map((r) => (r.level === 1 ? { ...r, ftpPct: 30 } : r)),
    };
    renderScreen();
    expect(await pctInput(1)).toHaveValue('30');
    fireEvent.click(screen.getByRole('button', { name: 'Restore defaults' }));
    const dialog = screen.getByRole('dialog', { name: 'Restore default zones?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(db.settings?.effortTable[0]?.ftpPct).toBe(30);

    fireEvent.click(screen.getByRole('button', { name: 'Restore defaults' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(db.settings?.effortTable).toEqual(DEFAULT_EFFORT_TABLE));
    expect(await pctInput(1)).toHaveValue('45');
  });
});

describe('Data', () => {
  const file = (text: string, name = 'backup.json') =>
    new File([text], name, { type: 'application/json' });

  async function pick(f: File) {
    const data = await section('data');
    fireEvent.change(within(data).getByTestId('import-file'), { target: { files: [f] } });
    return data;
  }

  it('exports the data through the download function', async () => {
    const download = vi.fn();
    render(
      <MemoryRouter>
        <DataSection download={download} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export data' }));
    await waitFor(() => expect(download).toHaveBeenCalled());
    const [blob, name] = download.mock.calls[0] as [Blob, string];
    expect(name).toMatch(/^spinning-tutor-\d{8}-\d{4}\.json$/);
    expect(blob.type).toBe('application/json');
  });

  it('reports a file that is not an export and leaves the data alone', async () => {
    renderScreen();
    await pick(file('{"hello": 1}'));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Replace' }));
    expect(await screen.findByTestId('import-result')).toHaveTextContent(
      'Import failed. The file is not a Spinning Tutor export.',
    );
    expect(db.replaced).toBeUndefined();
  });

  it('reports a file that is not JSON', async () => {
    renderScreen();
    await pick(file('nope'));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Replace' }));
    expect(await screen.findByTestId('import-result')).toHaveTextContent('not valid JSON');
  });

  it('asks before replacing and does nothing on cancel', async () => {
    renderScreen();
    await pick(file('{}', 'mine.json'));
    const dialog = screen.getByRole('dialog', { name: 'Replace all data?' });
    expect(dialog).toHaveTextContent('"mine.json"');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('import-result')).not.toBeInTheDocument();
  });

  it('imports a valid bundle and reloads the app', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const reload = vi.fn();
      const bundle: ExportBundle = {
        app: 'spinning-tutor',
        schemaVersion: 1,
        exportedAt: '2026-10-31T10:00:00.000Z',
        workouts: [],
        players: [{ id: 'z', name: 'Zed', ftp: 222 }],
        planProgress: [],
        sessionLogs: [],
        settings: null,
      };
      render(
        <MemoryRouter>
          <DataSection reload={reload} />
        </MemoryRouter>,
      );
      fireEvent.change(screen.getByTestId('import-file'), {
        target: { files: [file(JSON.stringify(bundle))] },
      });
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Replace' }));
      expect(await screen.findByText('Import finished. Reloading the app.')).toBeInTheDocument();
      expect(db.replaced?.players[0]?.name).toBe('Zed');
      await vi.advanceTimersByTimeAsync(2000);
      expect(reload).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows where the data lives', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ dbPath: 'C:/data/x.db' }) })),
    );
    try {
      renderScreen();
      expect(await screen.findByText('Database file: C:/data/x.db')).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back to a generic text when the server does not say', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
    try {
      renderScreen();
      expect(await screen.findByTestId('data-location')).toHaveTextContent(
        'Local database (the location is not available).',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows browser storage on the IndexedDB build', async () => {
    vi.stubEnv('VITE_STORAGE', 'indexeddb');
    try {
      renderScreen();
      expect(await screen.findByText(/Browser storage \(IndexedDB\)/)).toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('clears the recent YouTube links', async () => {
    db.settings = {
      ...DEFAULT_SETTINGS,
      recentYoutubeUrls: ['https://youtu.be/a', 'https://youtu.be/b'],
    };
    renderScreen();
    const data = await section('data');
    expect(await within(data).findByText('2 saved')).toBeInTheDocument();
    fireEvent.click(within(data).getByRole('button', { name: 'Clear recent links' }));
    await waitFor(() => expect(db.settings?.recentYoutubeUrls).toEqual([]));
    expect(await within(data).findByText('Recent links cleared')).toBeInTheDocument();
    expect(within(data).getByRole('button', { name: 'Clear recent links' })).toBeDisabled();
  });
});
