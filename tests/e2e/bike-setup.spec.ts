import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { Settings } from '../../src/domain/settings';
import { seedSettings } from './seed-settings';

async function openSetup(page: Page, info: Parameters<typeof seedSettings>[1]): Promise<void> {
  await page.clock.install();
  await seedSettings(page, info, 'build-form');
  await page.getByRole('button', { name: 'Ride', exact: true }).click();
  await expect(page.getByTestId('setup-screen')).toBeVisible();
}

test('Start without answering: rides with the defaults, the bike line is gone next time', async ({
  page,
}, info) => {
  await openSetup(page, info);
  await expect(page.getByTestId('bike-line')).toBeVisible();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('training-screen')).toBeVisible();

  // Back on the setup the line is gone, and Settings still offers the step.
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').getByRole('button', { name: 'End and see summary' }).click();
  await expect(page.getByTestId('summary-screen')).toBeVisible();
  await page.goto('./#/plan');
  await page.getByRole('button', { name: 'Ride', exact: true }).click();
  await expect(page.getByTestId('setup-screen')).toBeVisible();
  await expect(page.getByTestId('bike-line')).toBeHidden();
});

test('Manual knob: one screen, no FTP, nothing to calibrate (390px: no sideways scroll)', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSetup(page, info);
  await page.getByTestId('bike-open').click();
  await page.getByTestId('bike-kind-knob').click();
  await expect(page.getByTestId('bike-wizard')).toContainText('Step 1 of 1');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  await page.getByTestId('bike-next').click();
  await expect(page.getByTestId('bike-wizard')).toBeHidden();
  await expect(page.getByTestId('bike-line')).toBeHidden();

  await page.goto('./#/settings');
  await expect(page.getByTestId('bike-redo')).toBeAttached();
  await expect(page.getByText('S1')).toHaveCount(0);
});

test('A bike with a power meter is still asked for FTP', async ({ page }, info) => {
  await openSetup(page, info);
  await page.getByTestId('bike-open').click();
  await page.getByTestId('bike-kind-knobPower').click();
  await page.getByTestId('bike-next').click();
  await expect(page.getByTestId('bike-wizard')).toContainText('Step 2 of 2');
  await expect(page.getByTestId('bike-ftp-unknown')).toBeVisible();
});

test('Settings saved with the old knob steps still open', async ({ page }, info) => {
  const old = { knobSteps: [2, 4, 6, 8, 10], bikeSetupDone: true } as Partial<Settings>;
  await seedSettings(page, info, 'build-form', old);
  await page.getByRole('button', { name: 'Ride', exact: true }).click();
  await expect(page.getByTestId('setup-screen')).toBeVisible();
  await expect(page.getByTestId('bike-line')).toBeHidden();
});
