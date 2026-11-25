import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { expect, test } from './fixtures';

// The local project gives each worker one database for all its tests. What a test saves there must
// not reach the next test of the worker: stored settings win over the fresh-profile defaults (the
// metered bike of `seedMeteredBike`), so a ride test that landed after a spec which saved a setting
// used to see the plain knob bike and fail, but only on some shardings (training-basic "players").
// The tests of a file run in order on one worker; the second fails if the first one's data stays.

test.describe('worker isolation (local project)', () => {
  test('a test saves settings', async ({ request }, info) => {
    test.skip(info.project.name !== 'local', 'the pages build has a fresh IndexedDB per test');
    const put = await request.put('/api/settings', {
      data: {
        ...DEFAULT_SETTINGS,
        equipment: { ...DEFAULT_SETTINGS.equipment, showsWatts: false },
      },
    });
    expect(put.status()).toBe(204);
    expect((await request.get('/api/settings')).status()).toBe(200);
  });

  test('the next test starts from a fresh profile again', async ({ request }, info) => {
    test.skip(info.project.name !== 'local', 'the pages build has a fresh IndexedDB per test');
    // 204: nothing stored, so the app falls back to the fresh-profile defaults.
    expect((await request.get('/api/settings')).status()).toBe(204);
    expect((await request.get('/api/active-session')).status()).toBe(204);
  });
});
