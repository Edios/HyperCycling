import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { seedSettings } from './seed-settings';

async function openSetup(page: Page, info: Parameters<typeof seedSettings>[1]): Promise<void> {
  await page.clock.install();
  await seedSettings(page, info, 'build-form');
  await page.getByRole('button', { name: 'Ride', exact: true }).click();
  await expect(page.getByTestId('setup-screen')).toBeVisible();
}

test('Skip and ride: starts with the defaults, never asks again', async ({ page }, info) => {
  await openSetup(page, info);
  await expect(page.getByTestId('bike-card')).toBeVisible();
  await page.getByTestId('bike-skip-ride').click();
  await expect(page.getByTestId('training-screen')).toBeVisible();

  // Back on the setup the card is gone, and Settings still offers the step.
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').getByRole('button', { name: 'End and see summary' }).click();
  await expect(page.getByTestId('summary-screen')).toBeVisible();
  await page.goto('./#/plan');
  await page.getByRole('button', { name: 'Ride', exact: true }).click();
  await expect(page.getByTestId('setup-screen')).toBeVisible();
  await expect(page.getByTestId('bike-card')).toBeHidden();
});

test('Filling the bike step saves it and shows it in Settings (390px: no sideways scroll)', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSetup(page, info);
  await page.getByTestId('bike-open').click();
  await page.getByTestId('bike-kind-knob').click();
  await page.getByTestId('bike-next').click();
  await page.getByTestId('bike-ftp-unknown').click();
  const inputs = page.getByTestId('knob-steps').locator('input');
  await inputs.nth(0).fill('2');
  await inputs.nth(1).fill('4');
  await inputs.nth(2).fill('6');
  await inputs.nth(3).fill('8');
  await inputs.nth(4).fill('10');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  await page.getByTestId('bike-next').click();
  await expect(page.getByTestId('bike-wizard')).toBeHidden();
  await expect(page.getByTestId('bike-card')).toBeHidden();

  await page.goto('./#/settings');
  const panel = page.getByTestId('knob-steps-panel');
  await panel.scrollIntoViewIfNeeded();
  await expect(panel.locator('input').nth(4)).toHaveValue('10');
  await expect(panel.locator('input').nth(0)).toHaveValue('2');
});
