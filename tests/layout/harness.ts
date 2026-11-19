import fs from 'node:fs';
import path from 'node:path';
import type { Page, Route, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';
import type { Cell } from './matrix';
import { checkInvariants, type CheckOptions, type Violation } from './invariants';

/** Where findings (one JSON line per checked state) and screenshots go; read by scripts/layout-report.ts. */
export const OUT_DIR = path.resolve('test-results', 'layout');
export const FINDINGS_FILE = path.join(OUT_DIR, 'findings.jsonl');
export const SHOT_DIR = path.join(OUT_DIR, 'shots');
export const STATE_FILE = path.join(OUT_DIR, 'state.json');

/**
 * Only the caret is frozen up front: zeroing animation durations also stops the app's countdown
 * (it waits for animation events). Motion is settled at measuring time instead (see settle()).
 */
const FREEZE_CSS = `*, *::before, *::after { caret-color: transparent !important; }`;

export async function prepare(page: Page): Promise<void> {
  // Same as the e2e fixtures: the ride setup keeps "Advanced settings" closed unless remembered.
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('hypercycling.setup.advanced') === null)
        localStorage.setItem('hypercycling.setup.advanced', '1');
    } catch {
      // storage blocked: the accordion just starts closed
    }
  });
  await page.addInitScript((css) => {
    const add = (): void => {
      const s = document.createElement('style');
      s.setAttribute('data-layout-freeze', '');
      s.textContent = css;
      document.documentElement.appendChild(s);
    };
    if (document.documentElement) add();
    else document.addEventListener('DOMContentLoaded', add, { once: true });
  }, FREEZE_CSS);
}

/** Android "font size" / browser text zoom: scales the root font size, which the app's rem layout follows. */
async function applyTextScale(page: Page, factor: number): Promise<void> {
  await page.evaluate((f) => {
    const root = document.documentElement;
    if (!root.dataset.layoutBaseFont) {
      root.style.removeProperty('font-size');
      root.dataset.layoutBaseFont = String(parseFloat(getComputedStyle(root).fontSize));
    }
    const base = parseFloat(root.dataset.layoutBaseFont);
    root.style.setProperty('font-size', `${base * f}px`, 'important');
  }, factor);
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Jump entrance/exit animations to their resting state so geometry is measured at rest.
    document.getAnimations().forEach((a) => {
      try {
        if (a.effect?.getComputedTiming().iterations !== Infinity) a.finish();
      } catch {
        // an animation that cannot finish is left alone
      }
    });
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });
}

export interface Finding {
  scenario: string;
  state: string;
  viewport: string;
  size: string;
  variant: string;
  violations: Violation[];
  screenshot?: string;
}

export function safe(s: string): string {
  return s.replace(/[^a-z0-9._-]+/gi, '-');
}

/**
 * Builds the `check` function a scenario calls once per state (screen opened, menu open, layout
 * switched ...). It applies the text scale, measures, saves a screenshot when something is wrong
 * and appends the result to the findings file. In LAYOUT_STRICT=1 mode a "high" violation fails
 * the test; otherwise the project only reports.
 */
export function makeCheck(page: Page, info: TestInfo, scenario: string, cell: Cell) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  return async (state: string, options: CheckOptions = {}): Promise<Violation[]> => {
    if (cell.variant.textScale !== 1) await applyTextScale(page, cell.variant.textScale);
    await settle(page);
    const violations = await checkInvariants(page, options);
    const finding: Finding = {
      scenario,
      state,
      viewport: cell.viewport.id,
      size: `${cell.viewport.width}x${cell.viewport.height}`,
      variant: cell.variant.id,
      violations,
    };
    if (violations.length > 0) {
      const file = `${safe(scenario)}__${safe(state)}__${cell.viewport.id}__${cell.variant.id}.png`;
      await page.screenshot({ path: path.join(SHOT_DIR, file) });
      finding.screenshot = file;
      await info.attach(file, { path: path.join(SHOT_DIR, file), contentType: 'image/png' });
    }
    fs.appendFileSync(FINDINGS_FILE, `${JSON.stringify(finding)}\n`);
    if (process.env.LAYOUT_STRICT === '1')
      expect(violations.filter((v) => v.severity === 'high')).toEqual([]);
    return violations;
  };
}

// ---------------------------------------------------------------- app flows (pages build)

export async function startPlainRide(page: Page): Promise<void> {
  await page.goto('./?dev#/dev');
  // First dev row (the dev list is translated, so no name match).
  const row = page.getByTestId('workout-row').first();
  await row.getByRole('button', { name: /^(Ride|Jedź)$/ }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
  await pressSpaceUntilRunning(page);
}

export async function startExperienceRide(page: Page): Promise<void> {
  await page.goto('./#/setup/class-neon-grid-45?exp=neon-grid-45');
  await page.getByRole('button', { name: /^Start$/ }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
  await pressSpaceUntilRunning(page);
}

export async function pressSpaceUntilRunning(page: Page): Promise<void> {
  // The keydown binding can land just after the screen shows; press again until it starts.
  await expect(async () => {
    if ((await page.getByTestId('training-screen').getAttribute('data-status')) === 'idle')
      await page.keyboard.press('Space');
    await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'running', {
      timeout: 1500,
    });
  }).toPass({ timeout: 25_000 });
}

export const LONG_WORKOUT_NAME =
  'Bardzo długa nazwa treningu do sprawdzenia, czy układ ją mieści w każdym oknie';
const LONG_TRACK_TITLE = 'Running Up That Hill (A Deal With God) - 2018 Remaster Extended Mix';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};

/** Spotify answers from memory: one device, one search result with a long title, play works. */
export async function mockSpotify(page: Page, options: { noDevice?: boolean } = {}): Promise<void> {
  let playing: string | undefined;
  await page.route('https://accounts.spotify.com/authorize**', (route) => {
    const url = new URL(route.request().url());
    const back = new URL(url.searchParams.get('redirect_uri') ?? '');
    back.searchParams.set('code', 'layout-code');
    back.searchParams.set('state', url.searchParams.get('state') ?? '');
    return route.fulfill({ status: 302, headers: { location: back.toString() } });
  });
  await page.route('https://accounts.spotify.com/api/token', (route) =>
    route.fulfill({
      status: 200,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify({
        access_token: 'layout-access',
        refresh_token: 'layout-refresh',
        expires_in: 3600,
      }),
    }),
  );
  await page.route('https://api.spotify.com/**', (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        headers: { ...CORS, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    if (url.pathname === '/v1/search')
      return json({
        tracks: {
          items: [
            {
              id: 'layouttrack00abcdefg',
              name: LONG_TRACK_TITLE,
              duration_ms: 300_000,
              artists: [{ name: 'Kate Bush' }],
            },
          ],
        },
      });
    if (url.pathname === '/v1/me/player/devices')
      return json({
        devices: options.noDevice
          ? []
          : [{ id: 'D-PC', name: 'My PC', type: 'Computer', is_active: true }],
      });
    if (url.pathname === '/v1/me/player/play' && req.method() === 'PUT') {
      const uri = (req.postDataJSON() as { uris?: string[] } | null)?.uris?.[0];
      playing = uri?.split(':').pop();
    }
    if (url.pathname === '/v1/me/player' && req.method() === 'GET')
      return json({
        device: { id: 'D-PC', volume_percent: 80 },
        ...(playing
          ? { is_playing: true, progress_ms: 5_000, item: { id: playing, duration_ms: 300_000 } }
          : {}),
      });
    return route.fulfill({ status: 204, headers: CORS });
  });
}

/** Connects the mocked Spotify and saves a workout with a long name and a long track title. */
export async function buildMusicState(page: Page): Promise<void> {
  await mockSpotify(page);
  await page.goto('./#/settings');
  await page.getByLabel('Spotify Client ID').fill('layoutclientid');
  await page.getByTestId('spotify-connect').click();
  await expect(page.getByTestId('spotify-status')).toHaveAttribute('data-connected', 'true');
  await page.goto('./#/editor/new');
  await page.getByLabel('Workout name').fill(LONG_WORKOUT_NAME);
  await page.getByTestId('editor-block').nth(0).click();
  await page.getByTestId('spotify-query').fill('running up that hill');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByTestId('spotify-result')).toHaveCount(1);
  await page.getByRole('button', { name: `Use: ${LONG_TRACK_TITLE}` }).click();
  await expect(page.getByTestId('music-pill')).toContainText('Running Up');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/editor\/(?!new)/);
}

export async function openMusicWorkoutEditor(page: Page): Promise<void> {
  await page.goto('./#/freestyle');
  await page.getByRole('button', { name: /^(Mine|Moje)$/ }).click();
  await page.getByTestId('workout-card').filter({ hasText: 'Bardzo długa' }).click();
  await page
    .getByTestId('workout-preview')
    .getByRole('link', { name: /Bardzo długa/ })
    .click();
  await page
    .getByTestId('music-lane')
    .waitFor({ state: 'attached', timeout: 10_000 })
    .catch(() => undefined); // a hidden lane is a finding ("missing"), not a harness failure
}

export async function startMusicRide(page: Page): Promise<void> {
  await page.goto('./#/freestyle');
  await page.getByRole('button', { name: /^(Mine|Moje)$/ }).click();
  await page.getByTestId('workout-card').filter({ hasText: 'Bardzo długa' }).click();
  await page.getByTestId('workout-ride').click();
  await expect(page.getByTestId('setup-screen')).toBeVisible();
  // Music is on by default when the workout has tracks; turn it on if the switch says otherwise.
  const music = page.getByRole('switch', { name: /Music|Muzyk/ }).first();
  if ((await music.count()) > 0 && !(await music.isChecked())) await music.check();
  await page.getByRole('button', { name: /^Start$/ }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
  await pressSpaceUntilRunning(page);
  await page
    .getByTestId('now-playing')
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => undefined); // a missing chip is a finding ("missing"), not a harness failure
}
