import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  mockSpotify,
  makeCheck,
  openMusicWorkoutEditor,
  prepare,
  startExperienceRide,
  startMusicRide,
  startPlainRide,
  STATE_FILE,
} from './harness';
import type { CheckOptions } from './invariants';
import { cellsFor, type Cell, type Tag } from './matrix';

/**
 * Scenario table x viewport matrix. Every scenario opens one screen state (or a few) and runs the
 * layout invariants on it; see docs/superpowers/qa/ui-test-strategy.md. Findings are collected,
 * not asserted (unless LAYOUT_STRICT=1), so this project can never block CI.
 */
type Check = (state: string, options?: CheckOptions) => Promise<unknown>;

interface Scenario {
  id: string;
  /** Which viewports run it (see matrix.ts). */
  tags: Tag[];
  /** Needs the saved music state (mocked Spotify + a workout with a long name). */
  music?: boolean;
  run: (page: Page, check: Check, cell: Cell) => Promise<void>;
}

const PAGE: CheckOptions = { scrollsVertically: true };
/** The control bar hides while riding (by design), so "running" requires only the timeline. */
const TRAIN: CheckOptions = {
  scrollsVertically: false,
  required: [{ selector: '[data-testid="timeline"]', label: 'timeline' }],
};
const TRAIN_CONTROLS: CheckOptions = {
  ...TRAIN,
  required: [
    ...(TRAIN.required ?? []),
    { selector: '[data-testid="controls"]', label: 'control bar' },
  ],
};

/** A tap wakes the control bar (it is inert and hidden while the rider just pedals). */
async function revealControls(page: Page): Promise<void> {
  const vp = page.viewportSize() ?? { width: 800, height: 600 };
  await page.mouse.click(vp.width / 2, vp.height / 3);
  await page
    .waitForFunction(
      () => {
        const c = document.querySelector('[data-testid="controls"]');
        return !!c && !c.closest('[inert]') && getComputedStyle(c).visibility !== 'hidden';
      },
      undefined,
      { timeout: 5000 },
    )
    .catch(() => undefined); // still hidden after a tap: the "missing" rule reports it
}

async function open(page: Page, route: string, ready: string): Promise<void> {
  await page.goto(route);
  await page.reload();
  await expect(page.locator(ready).first()).toBeVisible();
}

const SCENARIOS: Scenario[] = [
  {
    id: 'home',
    tags: ['phone', 'wide'],
    run: async (page, check) => {
      await open(page, './#/', '[data-testid="home"]');
      await check('home', PAGE);
    },
  },
  {
    id: 'setup-plain',
    tags: ['phone', 'wide'],
    run: async (page, check) => {
      await open(page, './#/setup/demo-mixed', '[data-testid="setup-screen"]');
      await check('closed', PAGE);
      const adv = page.getByRole('button', { name: /Zaawansowane|Advanced/ });
      if (await adv.count()) {
        await adv.first().click();
        await check('advanced-open', PAGE);
      }
    },
  },
  {
    id: 'setup-experience',
    tags: ['phone', 'wide'],
    run: async (page, check) => {
      await open(
        page,
        './#/setup/class-neon-grid-45?exp=neon-grid-45',
        '[data-testid="setup-experience"]',
      );
      await check('experience-setup', PAGE);
    },
  },
  {
    id: 'settings',
    tags: ['phone', 'wide'],
    run: async (page, check) => {
      await open(page, './#/settings', '[data-testid="settings-screen"]');
      await check('settings', PAGE);
    },
  },
  {
    id: 'how-it-works',
    tags: ['phone'],
    run: async (page, check) => {
      await open(page, './#/how-it-works', '[data-testid="how-it-works"]');
      await check('how-it-works', PAGE);
    },
  },
  {
    id: 'lists',
    tags: ['phone'],
    run: async (page, check) => {
      for (const route of ['#/plans', '#/freestyle', '#/experiences', '#/players']) {
        await page.goto(`./${route}`);
        await page.waitForLoadState('networkidle');
        await check(route.slice(2), PAGE);
      }
    },
  },
  {
    id: 'editor-plain',
    tags: ['phone', 'wide'],
    run: async (page, check) => {
      await open(page, './?dev#/editor/demo-mixed', '[data-testid="editor-block"]');
      await check('editor', PAGE);
      await page.getByTestId('editor-block').nth(1).click();
      await check('block-selected', PAGE);
    },
  },
  {
    id: 'editor-music',
    tags: ['phone', 'wide'],
    music: true,
    run: async (page, check) => {
      await mockSpotify(page);
      await openMusicWorkoutEditor(page);
      await check('music-lane', {
        ...PAGE,
        required: [{ selector: '[data-testid="music-lane"]', label: 'music lane' }],
      });
      await page.getByTestId('editor-block').nth(1).click();
      await check('music-lane-block-selected', PAGE);
    },
  },
  {
    id: 'training-plain',
    tags: ['phone', 'wide'],
    run: async (page, check) => {
      await startPlainRide(page);
      await check('running', TRAIN);
      await revealControls(page);
      await check('controls-visible', TRAIN_CONTROLS);
      await page
        .getByRole('button', { name: /Quick settings|Szybkie ustawienia/ })
        .click({ timeout: 5000 })
        .catch(() => undefined);
      await check('quick-settings', TRAIN);
    },
  },
  {
    id: 'training-music',
    tags: ['phone', 'wide'],
    music: true,
    run: async (page, check) => {
      await mockSpotify(page);
      await startMusicRide(page);
      const chip = { selector: '[data-testid="now-playing"]', label: 'now-playing chip' };
      await check('now-playing', { ...TRAIN, required: [...(TRAIN.required ?? []), chip] });
      await revealControls(page);
      await check('now-playing-with-controls', {
        ...TRAIN_CONTROLS,
        required: [...(TRAIN_CONTROLS.required ?? []), chip],
      });
    },
  },
  {
    id: 'training-music-no-device',
    tags: ['core'],
    music: true,
    run: async (page, check) => {
      // No Spotify device: the ride continues without a chip and must not leave a hole or a stuck toast.
      await mockSpotify(page, { noDevice: true });
      await startMusicRide(page);
      await check('no-device', TRAIN);
    },
  },
  {
    id: 'experience-layouts',
    // The slowest scenario (WebGL world, five layouts): core viewports only, even at full depth.
    tags: ['core'],
    run: async (page, check) => {
      test.setTimeout(240_000);
      await startExperienceRide(page);
      // H cycles the five layouts (Corners, Column, Cockpit, Minimal, Focus).
      for (let i = 0; i < 5; i += 1) {
        await page.waitForTimeout(300);
        const id = await page
          .locator('[data-testid^="layout-"]')
          .first()
          .getAttribute('data-testid');
        await check(id ?? `layout-${i}`, TRAIN);
        await page.keyboard.press('KeyH');
      }
    },
  },
];

for (const scenario of SCENARIOS) {
  test.describe(scenario.id, () => {
    for (const cell of cellsFor(scenario.tags)) {
      test.describe(`${cell.viewport.id} ${cell.variant.id}`, () => {
        test.use({
          viewport: { width: cell.viewport.width, height: cell.viewport.height },
          locale: cell.variant.locale,
          colorScheme: cell.variant.colorScheme,
          isMobile: cell.viewport.mobile,
          hasTouch: cell.viewport.mobile,
          deviceScaleFactor: 1,
          ...(scenario.music ? { storageState: STATE_FILE } : {}),
        });
        test('layout invariants', async ({ page }, info) => {
          await prepare(page);
          const check = makeCheck(page, info, scenario.id, cell);
          await scenario.run(page, check, cell);
        });
      });
    }
  });
}
