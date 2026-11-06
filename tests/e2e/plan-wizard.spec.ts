import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.WIZARD_SHOTS; // output directory; unset in normal runs

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Walks the wizard: Build form, 3 days, 45 min, and the given FTP answer. */
async function walk(page: Page, ftp: 'unknown' | number, shots = false): Promise<void> {
  await page.goto('./#/plans');
  await page.getByRole('link', { name: 'Plan wizard' }).click();
  await expect(page.getByTestId('plan-wizard')).toBeVisible();
  await expect(page.getByTestId('wizard-step')).toHaveCount(4);

  await expect(page.getByRole('radio')).toHaveCount(4);
  await page.getByRole('radio', { name: /Build Form/ }).check({ force: true });
  if (shots) await shot(page, '1-goal');
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  await page.getByRole('radio', { name: '3 days' }).check({ force: true });
  await page.getByRole('radio', { name: '45 min' }).check({ force: true });
  if (shots) await shot(page, '2-time');
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  if (ftp === 'unknown') {
    await page.getByRole('radio', { name: /I don.t know it/ }).check({ force: true });
  } else {
    await page.getByRole('radio', { name: /Yes, I know it/ }).check({ force: true });
    await page.getByLabel('FTP in watts').fill(String(ftp));
  }
  if (shots) await shot(page, '3-ftp');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
}

async function start(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  // Another spec may have left a plan in the shared database. The confirmation appears after an
  // awaited repository read, so wait for either outcome instead of probing the dialog once.
  const dialog = page.getByRole('dialog');
  const nextSession = page.getByTestId('next-session');
  await expect(dialog.or(nextSession)).toBeVisible();
  if (await dialog.isVisible()) {
    // "Start over" (this plan has progress, followed by a second confirmation) or
    // "Start <plan>" (another plan is active).
    const startOver = dialog.getByRole('button', { name: 'Start over' });
    if (await startOver.isVisible()) {
      await startOver.click();
      await page.getByRole('dialog').getByRole('button', { name: 'Erase and start over' }).click();
    } else {
      await dialog.getByRole('button', { name: /^Start / }).click();
    }
  }
  await expect(nextSession).toBeVisible();
}

test('unknown FTP: recommendation shows the test, plan starts with the 20-min test', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 412, height: 915 });
  await walk(page, 'unknown', true);

  await expect(page.getByTestId('wizard-reason')).toContainText('20-minute test');
  await expect(
    page.getByTestId('calendar-week').first().getByTestId('calendar-test'),
  ).toBeVisible();
  await shot(page, '4-recommendation-412x915');
  await page.setViewportSize({ width: 1280, height: 720 });
  await shot(page, '4-recommendation-1280x720');

  await start(page);
  await expect(page.getByTestId('next-session')).toContainText(/test/i);
  expect(errors).toEqual([]);
});

test('known FTP: no test in week 1 and the "me" player gets the FTP', async ({ page }) => {
  await walk(page, 230);

  await expect(page.getByTestId('wizard-reason')).toContainText('FTP is known');
  // Later weeks may still hold a re-test; the first test is what gets skipped.
  await expect(page.getByTestId('calendar-week').first().getByTestId('calendar-test')).toHaveCount(
    0,
  );

  await start(page);
  await expect(page.getByTestId('next-session')).not.toContainText(/test/i);

  await page.goto('./#/players');
  await expect(page.getByTestId('players-screen')).toBeVisible();
  await expect(page.getByTestId('player-row').filter({ hasText: '230' }).first()).toBeVisible();
});

test('optional training days: chosen weekdays shape the calendar, none keeps the default', async ({
  page,
}) => {
  await page.goto('./#/plans');
  await page.getByRole('link', { name: 'Plan wizard' }).click();
  await page.getByRole('radio', { name: /Build Form/ }).check({ force: true });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('radio', { name: '2 days' }).check({ force: true });
  // Skipping the picker is allowed.
  await expect(page.getByTestId('day-picker')).toContainText('No fixed days');
  await page.getByRole('button', { name: 'Tuesday' }).click();
  await page.getByRole('button', { name: 'Saturday' }).click();
  await expect(page.getByRole('button', { name: 'Tuesday' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('radio', { name: /I don.t know it/ }).check({ force: true });
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  const week = page.getByTestId('calendar-week').first();
  const cells = week.getByRole('cell');
  // Mon..Sun: rides on Tuesday (1) and Saturday (5)
  await expect(cells.nth(1)).not.toHaveAttribute('class', /rest/);
  await expect(cells.nth(5)).not.toHaveAttribute('class', /rest/);
  await expect(cells.nth(0)).toHaveAttribute('class', /rest/);
});
