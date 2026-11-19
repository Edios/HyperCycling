import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The editor's music lane on a phone (portrait and landscape) and a laptop: tracks are as long as
 * they play, nothing overlaps or leaves the screen, the lane sits on the timeline's time scale and
 * is never covered by the chart. Screenshots go to test-results for the PR.
 */
// Never a sound from a test browser (the shared config gets the same flag in the e2e fix).
test.use({ launchOptions: { args: ['--mute-audio'] } });

const SIZES = [
  { name: 'phone-portrait', width: 390, height: 844 },
  { name: 'phone-landscape', width: 844, height: 390 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

const YT = 'https://youtu.be/dQw4w9WgXcQ';
const YT2 = 'https://youtu.be/9bZkp7q19f0';

async function mockYoutube(page: Page): Promise<void> {
  await page.route('https://www.youtube.com/oembed**', (route) => {
    const url = decodeURIComponent(route.request().url());
    const title = url.includes('9bZkp7q19f0') ? 'Second Song' : 'First Song';
    return route.fulfill({ json: { title, author_name: 'E2E' } });
  });
}

type Box = { x: number; y: number; width: number; height: number };

async function box(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  if (!b) throw new Error('no box');
  return b;
}

async function boxes(l: Locator): Promise<Box[]> {
  const out: Box[] = [];
  for (let i = 0; i < (await l.count()); i++) out.push(await box(l.nth(i)));
  return out;
}

function expectNoOverlapX(list: Box[], what: string): void {
  const sorted = [...list].sort((a, b) => a.x - b.x);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1] as Box;
    const cur = sorted[i] as Box;
    expect(cur.x, `${what}: item ${i} starts before the previous one ends`).toBeGreaterThanOrEqual(
      prev.x + prev.width - 0.5,
    );
  }
}

function expectInsideViewport(b: Box, width: number, what: string): void {
  expect(b.x, `${what} left`).toBeGreaterThanOrEqual(-0.5);
  expect(b.x + b.width, `${what} right`).toBeLessThanOrEqual(width + 0.5);
}

/** A new workout; the warm-up gets a 3:00 track (start 0:00, end 3:00), then block 2 is selected. */
async function buildLane(page: Page): Promise<void> {
  await mockYoutube(page);
  await page.goto('./#/editor/new');
  await expect(page.getByTestId('editor-screen')).toBeVisible();
  await page.getByTestId('editor-block').nth(0).click();
  await page.getByTestId('track-url').fill(YT);
  await page.getByTestId('track-end').fill('3:00');
  await page.getByRole('button', { name: 'Pin track' }).click();
  await expect(page.getByTestId('music-pill')).toContainText('First Song');
  await expect(page.getByTestId('music-pill')).toContainText('3:00');
}

for (const size of SIZES) {
  test(`music lane geometry and layout at ${size.name}`, async ({ page }, info) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await buildLane(page);
    const lane = page.getByTestId('music-lane');
    const timeline = page.getByTestId('editor-timeline');
    const pill = page.getByTestId('music-pill');
    const warmup = page.getByTestId('editor-block').nth(0);

    // The track is 3:00 long, not stretched over the 10:00 warm-up: free time follows it.
    await expect(pill).toHaveAttribute('data-end', '180');
    const next = page.getByTestId('music-add-next');
    await expect(next).toBeVisible();

    // Same time scale as the bars: the track starts where the warm-up bar starts and covers the
    // share of it the 3:00 take.
    const p = await box(pill);
    const w = await box(warmup);
    const warmupSec = Number(await warmup.getAttribute('data-duration'));
    expect(Math.abs(p.x - w.x)).toBeLessThanOrEqual(3);
    expect(Math.abs(p.width + 3 - (w.width * 180) / warmupSec)).toBeLessThanOrEqual(4);

    // Selecting block 2 puts the pin placeholder at its start, beside (not over) the track.
    await page.getByTestId('editor-block').nth(1).click();
    const pin = page.getByTestId('music-pin');
    await expect(pin).toBeVisible();
    const b2 = await box(page.getByTestId('editor-block').nth(1));
    expect(Math.abs((await box(pin)).x - b2.x)).toBeLessThanOrEqual(3);
    const laneItems = lane.locator('button');
    expectNoOverlapX(await boxes(laneItems), 'music lane');
    for (const b of await boxes(laneItems)) expectInsideViewport(b, size.width, 'lane item');

    // The chart never covers the lane (it shrank to nothing on landscape phones before).
    await lane.scrollIntoViewIfNeeded();
    const l = await box(lane);
    // Full height (2.75rem, at least a 44 px touch target), not squeezed by the chart below it.
    const rem = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.documentElement).fontSize),
    );
    expect(l.height).toBeGreaterThanOrEqual(Math.max(2.75 * rem, 44) - 1);
    expect(Math.abs((await box(pill)).height - l.height)).toBeLessThanOrEqual(1);
    expect((await box(timeline)).y).toBeGreaterThanOrEqual(l.y + l.height - 0.5);

    // Song / cool-down add buttons: one aligned row, labels not cut.
    const adds = page.locator('[data-testid="song-add"], [data-testid="cooldown-add"]');
    for (let i = 0; i < (await adds.count()); i++) {
      const el = adds.nth(i);
      expectInsideViewport(await box(el), size.width, 'add button');
      const cut = await el.evaluate((e) => e.scrollWidth > e.clientWidth + 1);
      expect(cut, 'add button label is cut').toBe(false);
    }
    expectNoOverlapX(await boxes(adds), 'add buttons');

    // The exact %FTP field is grouped with the effort buttons (right under them).
    const levels = await box(page.getByRole('group', { name: 'Effort' }).first());
    const ftp = await box(page.getByTestId('exact-ftp'));
    // Beside the caption, or on the next line in a narrow panel; never a block further down.
    expect(ftp.y - (levels.y + levels.height)).toBeLessThanOrEqual(48);
    expect(ftp.y).toBeGreaterThan(levels.y);

    // Nothing scrolls sideways.
    const wide = await page.evaluate(
      () => (document.scrollingElement?.scrollWidth ?? 0) <= window.innerWidth,
    );
    expect(wide).toBe(true);

    // The header stays compact on a landscape phone.
    if (size.height < 500) {
      await page.evaluate(() => window.scrollTo(0, 0));
      const header = await box(page.locator('header').first());
      expect(header.height).toBeLessThanOrEqual(size.height * 0.3);
    }

    await page.getByTestId('editor-block').nth(0).click();
    await lane.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath(`editor-music-${size.name}.png`),
      fullPage: size.name !== 'desktop',
    });
  });
}

test('trimming: drag the end handle, the fields follow, and a next track fills the gap', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await buildLane(page);
  const pill = page.getByTestId('music-pill');
  const handle = page.locator('[data-handle="trim-end"]');
  await expect(handle).toBeVisible();
  const before = await box(pill);
  const h = await box(handle);
  // Drag 40 px to the left: the track gets shorter, its end lands in the End field.
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 - 20, h.y + h.height / 2, { steps: 4 });
  await page.mouse.move(h.x + h.width / 2 - 40, h.y + h.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await box(pill)).width).toBeLessThan(before.width - 30);
  const end = await page.getByTestId('track-end').inputValue();
  expect(end).toMatch(/^[0-2]:\d\d$/);

  // The start field trims the beginning: 0:30 -> the track plays 30 s less.
  const playedBefore = Number(await pill.getAttribute('data-end'));
  await page.getByTestId('track-start').fill('0:30');
  await page.getByRole('button', { name: 'Pin track' }).click();
  await expect(pill).toHaveAttribute('data-end', String(playedBefore - 30));

  // "+ next track" opens the queue field; the added track plays right after the first.
  await page.getByTestId('music-add-next').click();
  await expect(page.getByTestId('queue-url')).toBeFocused();
  await page.getByTestId('queue-url').fill(YT2);
  await page.getByTestId('queue-add').click();
  await expect(page.getByTestId('music-pill')).toHaveCount(2);
  await expect(page.getByTestId('music-pill').nth(1)).toContainText('Second Song');
  await expect(page.getByTestId('music-pill').nth(1)).toHaveAttribute(
    'data-start',
    String(playedBefore - 30),
  );
  // Length unknown: shown as an estimate, with the rest of the slot hatched.
  await expect(page.getByTestId('music-pill').nth(1)).toHaveAttribute('data-estimated', 'true');
  await expect(page.getByTestId('music-tail')).toHaveCount(1);
});
