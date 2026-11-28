import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// "Test the trainer in a minute" on the fake navigator.bluetooth of the e2e build: reads, one ERG
// step, a verdict in words and a copied report. Pages build only (real time, about 30 s).

declare global {
  interface Window {
    __pump?: ReturnType<typeof setInterval>;
  }
}

test.beforeEach(({ browserName }, info) => {
  void browserName; // Playwright needs a destructured fixture argument
  test.skip(info.project.name !== 'pages', 'runs on the pages build only');
});

async function withFakeDevices(page: Page, hash: string): Promise<void> {
  await page.goto('./');
  await page.waitForFunction(() => window.__hcBle !== undefined);
  await page.evaluate((h) => {
    const hook = window.__hcBle!;
    const fake = hook.installFake({
      trainer: new hook.FakeTrainer({ noiseW: 2, freeRidePowerW: 110, powerTimeConstantMs: 1500 }),
      hr: new hook.FakeHrSensor({ bpm: () => 132 }),
    });
    window.__pump = setInterval(() => fake.pump(Date.now()), 500);
    location.hash = h;
  }, hash);
}

test('the setup links to the test; the test reads, steps ERG and says "All good"', async ({
  page,
  context,
}) => {
  test.setTimeout(150_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await withFakeDevices(page, '#/setup/demo-mixed');
  await page.getByTestId('trainer-test-link').click();
  const test1 = page.getByTestId('trainer-test');
  await expect(test1).toBeVisible();
  await expect(page.getByTestId('trainer-test-start')).toBeDisabled();
  await test1.getByRole('button', { name: 'Connect trainer' }).click();
  await test1.getByRole('button', { name: 'Connect strap' }).click();
  await expect(test1.getByText('132 bpm')).toBeVisible();
  await page.getByTestId('trainer-test-start').click();
  await expect(page.getByTestId('trainer-test-phase')).toContainText('Reading the sensors');
  await expect(page.getByTestId('trainer-test-phase')).toContainText('ERG', { timeout: 30_000 });
  await expect(page.getByTestId('trainer-test-verdict')).toHaveText('All good', {
    timeout: 90_000,
  });
  await expect(page.getByTestId('trainer-test-reaction')).toHaveText(/^\d+\.\d s$/);
  await page.getByTestId('trainer-test-copy').click();
  await expect(page.getByTestId('trainer-test-copy')).toHaveText('Report copied');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('HyperCycling trainer test');
  expect(text).toMatch(/ERG: step 100 -> 150 W: reaction \d+\.\d s/);
  expect(text).toContain('heart rate: avg 132 bpm');
  expect(text).toContain('result: OK');
});

test('without pedalling data the test says what to do', async ({ page }) => {
  test.setTimeout(150_000);
  await withFakeDevices(page, '#/settings?section=equipment');
  await page.getByTestId('trainer-test-open').click();
  const box = page.getByTestId('trainer-test');
  await box.getByRole('button', { name: 'Connect trainer' }).click();
  await expect(page.getByTestId('trainer-test-start')).toBeEnabled();
  // The trainer goes silent: no notifications reach the page any more.
  await page.evaluate(() => clearInterval(window.__pump));
  await page.getByTestId('trainer-test-start').click();
  await expect(page.getByTestId('trainer-test-verdict')).toHaveText('Problem', {
    timeout: 90_000,
  });
  await expect(page.getByTestId('trainer-test-notes')).toContainText('No power arrived');
});
