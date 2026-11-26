import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { matchMusicInSetup, stubYoutube } from './music-player';

// The song order of the next ride (backlog "save the song order after a ride"): the ride setup of
// a workout with saved music plays the last order again or draws a new one, and after a ride on a
// new order the summary saves it. Local build: the saved plan is read back through the API.

const WORKOUT = 'music-climbs';

async function savedIds(page: Page): Promise<string[]> {
  const res = await page.request.get(`/api/soundtrack-plans/${WORKOUT}`);
  expect(res.ok()).toBe(true);
  const rec = (await res.json()) as {
    plan: { sections: { picks: { ref: { id: string } }[] }[] };
  };
  return rec.plan.sections.flatMap((s) => s.picks.map((p) => p.ref.id));
}

test('song order: draw a new one in the setup, save it after the ride, it plays next time', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'local', 'reads the saved plan through the server API');
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await stubYoutube(page);
  try {
    await matchMusicInSetup(page, WORKOUT);
    const before = await savedIds(page);

    // Opened again: the saved music, its order played again unless a new one is drawn.
    await page.reload();
    const row = page.getByTestId('setup-soundtrack');
    await expect(row).toHaveAttribute('data-state', 'ready');
    const order = row.getByRole('radiogroup', { name: 'Song order' });
    await expect(order.getByRole('radio', { name: 'Last order' })).toBeChecked();
    await expect(row).toContainText('The saved order of songs plays again.');
    await order.getByText('New order').click();
    await expect(order.getByRole('radio', { name: 'New order' })).toBeChecked();
    await expect(row).toContainText('You can save it after the ride.');
    await expect(row).toHaveAttribute('data-state', 'ready');
    // Drawn for this ride only: the saved plan is the same.
    expect(await savedIds(page)).toEqual(before);

    // The ride itself (the songs are not what is checked here): start, ride a moment, end.
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    const screen = page.getByTestId('training-screen');
    await expect(async () => {
      if ((await screen.getAttribute('data-status')) === 'idle') await page.keyboard.press('Space');
      await expect(screen).toHaveAttribute('data-status', 'running', { timeout: 1500 });
    }).toPass({ timeout: 20_000 });
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').getByRole('button', { name: 'End and see summary' }).click();
    const card = page.getByTestId('summary-song-order');
    await expect(card).toContainText('This ride had a new order of songs.');
    await card.getByRole('button', { name: 'Save the song order' }).click();
    await expect(card).toContainText(
      'Saved: the next ride of this workout plays this order again.',
    );
    const after = await savedIds(page);
    expect(after).not.toEqual(before);

    // The next ride of the workout plays the saved (new) order again.
    await page.goto(`./#/setup/${WORKOUT}`);
    await page.reload();
    await expect(page.getByTestId('setup-soundtrack')).toHaveAttribute('data-state', 'ready');
    await expect(
      page
        .getByRole('radiogroup', { name: 'Song order' })
        .getByRole('radio', { name: 'Last order' }),
    ).toBeChecked();
    expect(errors).toEqual([]);
  } finally {
    // The worker's database is shared with other tests: leave it as found, pass or fail.
    await page.request.delete(`/api/soundtrack-plans/${WORKOUT}`);
  }
});
