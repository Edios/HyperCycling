import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN_SETTINGS } from '../../domain/plan';
import { totalDurationSec } from '../../domain/workout';
import { builtinWorkouts } from '../data/builtin';
import {
  applyPlanSettings,
  buildConfig,
  effectiveHud,
  initialSelection,
  layoutOptions,
  parsePlanRef,
  pickPlayers,
  ridersAvailable,
  ridersHintKey,
} from './model';

describe('applyPlanSettings', () => {
  it('keeps every test workout at its natural length and difficulty', () => {
    const tests = builtinWorkouts.filter((w) => w.tags.includes('test'));
    expect(tests.map((w) => w.id)).toContain('ramp-test');
    for (const w of tests) {
      const out = applyPlanSettings(w, {
        ...DEFAULT_PLAN_SETTINGS,
        sessionMinutes: 30,
        difficulty: 5,
      });
      expect(totalDurationSec(out), w.id).toBe(totalDurationSec(w));
      expect(out, w.id).toEqual(w);
    }
  });
  it('still scales an ordinary scalable workout', () => {
    const w = builtinWorkouts.find((x) => x.scaling && !x.tags.includes('test'))!;
    const out = applyPlanSettings(w, { ...DEFAULT_PLAN_SETTINGS, sessionMinutes: 30 });
    expect(totalDurationSec(out)).toBeLessThan(totalDurationSec(w));
  });
});

const rider = (id: string, isMe = false) => ({ id, name: id, ftp: 200, ...(isMe ? { isMe } : {}) });

describe('initialSelection', () => {
  it('keeps the saved riders that still exist', () => {
    expect(initialSelection([rider('a'), rider('b')], ['b', 'gone'])).toEqual(['b']);
  });
  it('falls back to the me rider', () => {
    expect(initialSelection([rider('a'), rider('b', true)], [])).toEqual(['b']);
  });
  it('falls back to the only rider', () => {
    expect(initialSelection([rider('a')], undefined)).toEqual(['a']);
  });
  it('selects nobody when several riders and none is me', () => {
    expect(initialSelection([rider('a'), rider('b')], [])).toEqual([]);
  });
});

describe('ridersHintKey / ridersAvailable', () => {
  it('explains a Show riders switch that has no rider to show', () => {
    expect(ridersHintKey('classic', false)).toBe('setup.ridersHint.none');
    expect(ridersAvailable('classic', false)).toBe(false);
    expect(ridersHintKey('classic', true)).toBeUndefined();
    expect(ridersAvailable('focus', true)).toBe(true);
  });
  it('explains the layouts that have no room for the riders panel', () => {
    for (const kind of ['cockpit', 'tunnelTime'] as const) {
      expect(ridersHintKey(kind, true)).toBe('setup.ridersHint.noRoom');
      expect(ridersAvailable(kind, true)).toBe(false);
    }
  });
});

describe('layoutOptions', () => {
  it('every background offers every layout; only Classic is Basic-only', () => {
    const overlays = ['immersive', 'column', 'cockpit', 'tunnelTime', 'focus'];
    expect(layoutOptions('basic').map((o) => o.value)).toEqual(['classic', ...overlays]);
    for (const bg of ['hyperride', 'youtube'] as const) {
      expect(layoutOptions(bg).map((o) => o.value)).toEqual(overlays);
    }
  });
});

describe('effectiveHud', () => {
  it('stores Classic as solo / players depending on the riders switch', () => {
    expect(effectiveHud('basic', undefined, false)).toBe('solo');
    expect(effectiveHud('basic', undefined, true)).toBe('players');
    expect(effectiveHud('basic', 'classic', true, false)).toBe('solo');
    expect(effectiveHud('basic', 'classic', false)).toBe('solo');
  });

  it('keeps every layout on every background, with or without riders', () => {
    for (const bg of ['basic', 'hyperride', 'youtube'] as const) {
      for (const hud of ['immersive', 'column', 'cockpit', 'tunnelTime', 'focus'] as const) {
        expect(effectiveHud(bg, hud, true)).toBe(hud);
        expect(effectiveHud(bg, hud, false)).toBe(hud);
      }
    }
  });

  it('falls back to the default layout when Classic is chosen off Basic', () => {
    expect(effectiveHud('hyperride', 'classic', false)).toBe('immersive');
  });
});

describe('buildConfig', () => {
  it('turns music off for a workout without cues but keeps the ids', () => {
    expect(
      buildConfig({ background: 'basic', hud: undefined, playerIds: ['a'], music: true }, false),
    ).toEqual({ background: 'basic', hud: 'players', playerIds: ['a'], music: false });
  });

  it('records a switched-off riders panel on an overlay layout', () => {
    const cfg = buildConfig(
      { background: 'hyperride', hud: 'focus', playerIds: ['a'], music: false, showRiders: false },
      false,
    );
    expect(cfg).toMatchObject({ hud: 'focus', showRiders: false });
  });
});

describe('parsePlanRef / pickPlayers', () => {
  it('reads an optional cycle and rejects a bad one', () => {
    expect(parsePlanRef(new URLSearchParams('plan=p&week=2&slot=progres&cycle=2'))).toEqual({
      planId: 'p',
      week: 2,
      slot: 'progres',
      cycle: 2,
    });
    expect(parsePlanRef(new URLSearchParams('plan=p&week=2&slot=progres&cycle=0'))).toBeUndefined();
  });

  it('needs plan, a positive integer week and a known slot', () => {
    expect(parsePlanRef(new URLSearchParams('plan=p&week=2&slot=progres'))).toEqual({
      planId: 'p',
      week: 2,
      slot: 'progres',
    });
    expect(parsePlanRef(new URLSearchParams('plan=p&week=0&slot=progres'))).toBeUndefined();
    expect(parsePlanRef(new URLSearchParams('plan=p&week=2&slot=x'))).toBeUndefined();
    expect(parsePlanRef(new URLSearchParams(''))).toBeUndefined();
  });

  it('keeps the order of the ids and drops unknown ones', () => {
    const a = { id: 'a', name: 'A', ftp: 100 };
    const b = { id: 'b', name: 'B', ftp: 100 };
    expect(pickPlayers([a, b], ['b', 'zzz', 'a'])).toEqual([b, a]);
  });
});
