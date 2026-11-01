import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN_SETTINGS } from '../../domain/plan';
import { totalDurationSec } from '../../domain/workout';
import { builtinWorkouts } from '../data/builtin';
import {
  applyPlanSettings,
  buildConfig,
  effectiveHud,
  initialSelection,
  layoutHintKey,
  layoutOptions,
  parsePlanRef,
  pickPlayers,
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

describe('layoutHintKey', () => {
  it('explains the disabled With players on Basic', () => {
    expect(layoutHintKey('basic', false)).toBe('setup.layoutHint.basicNoPlayers');
    expect(layoutHintKey('basic', true)).toBeUndefined();
  });
  it('explains where the players column lives on Hyperride and YouTube', () => {
    expect(layoutHintKey('hyperride', false)).toBe('setup.layoutHint.overlay');
    expect(layoutHintKey('youtube', true)).toBe('setup.layoutHint.overlayPlayers');
  });
});

describe('layoutOptions', () => {
  it('Basic offers only Solo and With players', () => {
    expect(layoutOptions('basic', false).map((o) => o.value)).toEqual(['solo', 'players']);
    expect(layoutOptions('basic', false)[1]?.disabled).toBe(true);
    expect(layoutOptions('basic', true)[1]?.disabled).toBeFalsy();
  });

  it('overlay backgrounds disable Cockpit and Tunnel when players are selected', () => {
    for (const bg of ['hyperride', 'youtube'] as const) {
      const solo = layoutOptions(bg, false);
      expect(solo.map((o) => o.value)).toEqual(['immersive', 'column', 'cockpit', 'tunnelTime']);
      expect(solo.every((o) => !o.disabled)).toBe(true);
      const group = layoutOptions(bg, true);
      expect(group.filter((o) => o.disabled).map((o) => o.value)).toEqual([
        'cockpit',
        'tunnelTime',
      ]);
    }
  });
});

describe('effectiveHud', () => {
  it('is automatic on Basic', () => {
    expect(effectiveHud('basic', undefined, false)).toBe('solo');
    expect(effectiveHud('basic', undefined, true)).toBe('players');
    expect(effectiveHud('basic', 'solo', true)).toBe('solo');
    expect(effectiveHud('basic', 'players', false)).toBe('solo');
  });

  it('falls back to immersive when the chosen overlay layout becomes disabled', () => {
    expect(effectiveHud('hyperride', 'cockpit', false)).toBe('cockpit');
    expect(effectiveHud('hyperride', 'cockpit', true)).toBe('immersive');
  });
});

describe('buildConfig', () => {
  it('turns music off for a workout without cues but keeps the ids', () => {
    expect(
      buildConfig({ background: 'basic', hud: undefined, playerIds: ['a'], music: true }, false),
    ).toEqual({ background: 'basic', hud: 'players', playerIds: ['a'], music: false });
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
