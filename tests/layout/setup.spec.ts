import { expect, test } from '@playwright/test';
import { buildMusicState, prepare, STATE_FILE } from './harness';
import fs from 'node:fs';
import path from 'node:path';

// Runs once before the layout project: connects a mocked Spotify and saves one workout with a
// long name and a long track title, then stores the browser state (localStorage + IndexedDB) so
// the music scenarios start from it without repeating the editor flow.
test('prepare music state', async ({ page, context }) => {
  test.setTimeout(90_000);
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  await prepare(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await buildMusicState(page);
  await context.storageState({ path: STATE_FILE, indexedDB: true });
  expect(fs.existsSync(STATE_FILE)).toBe(true);
});
