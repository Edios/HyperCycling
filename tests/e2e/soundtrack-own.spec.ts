import { expect, test } from './fixtures';

// The rider's own songs in "Match music" (Soundtrack Match PR 6): added in step 1, kept on the
// device (the local build: the server's SQLite; the pages build: IndexedDB), and picked by the
// planner where their tempo fits the cadence.

const SONGS = [
  { id: 'ownTestAa01', title: 'Own Climb', bpm: '140', energy: '4' },
  { id: 'ownTestBb02', title: 'Own Spin', bpm: '180', energy: '3' },
  { id: 'ownTestCc03', title: 'Own Grind', bpm: '130', energy: '4' },
  { id: 'ownTestDd04', title: 'Own Easy', bpm: '176', energy: '2' },
];

async function toWizard(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('./#/freestyle');
  await page.getByRole('searchbox').fill('Climbs to Music');
  await page.getByTestId('workout-card').first().click();
  await page.getByTestId('workout-match-music').click();
  await expect(page.getByTestId('soundtrack-wizard')).toBeVisible();
}

test('own songs: added in step 1, picked in the plan, still there after a reload', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await toWizard(page);
  const own = page.getByTestId('soundtrack-own');
  await own.getByRole('button', { name: /My songs/ }).click();
  const use = page.getByRole('switch', { name: 'Use my songs' });
  await expect(use).toBeDisabled();

  for (const s of SONGS) {
    await page.getByTestId('soundtrack-own-link').fill(`https://youtu.be/${s.id}`);
    await page.getByTestId('soundtrack-own-title').fill(s.title);
    await page.getByTestId('soundtrack-own-bpm').fill(s.bpm);
    await page.getByTestId('soundtrack-own-energy').selectOption(s.energy);
    await page.getByTestId('soundtrack-own-add').click();
    await expect(own.getByText(`Added: ${s.title}`)).toBeVisible();
  }
  await expect(page.getByTestId('soundtrack-own-song')).toHaveCount(SONGS.length);
  // The first song turned the switch on.
  await expect(use).toBeChecked();

  // Step 2: at least one own song is in the plan, with its tempo.
  await page.getByTestId('soundtrack-next').click();
  const ownSongs = page.locator('[data-testid="soundtrack-song"][data-song^="own-"]');
  await expect(ownSongs.first()).toBeVisible();
  await expect(ownSongs.first()).toContainText('BPM');

  await page.getByTestId('soundtrack-next').click();
  await page.getByRole('button', { name: 'To the ride' }).click();
  await expect(page.getByTestId('setup-soundtrack')).toHaveAttribute('data-state', 'ready');

  // A reload: the saved plan compiles with the own songs read from the device again.
  await page.reload();
  await expect(page.getByTestId('setup-soundtrack')).toHaveAttribute('data-state', 'ready');

  // The list is still there, and the switch is remembered (the section opens by itself then).
  await toWizard(page);
  await expect(
    page.getByTestId('soundtrack-own').getByRole('button', { name: /My songs/ }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('soundtrack-own-song')).toHaveCount(SONGS.length);
  await expect(page.getByRole('switch', { name: 'Use my songs' })).toBeChecked();
  expect(errors).toEqual([]);
});
