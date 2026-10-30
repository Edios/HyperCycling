import { describe, expect, it } from 'vitest';
import { en } from '../client/i18n/en';
import { pl } from '../client/i18n/pl';
import { builtinPlans, builtinWorkouts } from '../client/data/builtin';
import { planSchema, weeklyLoad, type Plan } from '../domain/plan';
import { scaleWorkout } from '../domain/scale';
import { flattenWorkout } from '../domain/segments';
import { totalDurationSec, workoutSchema, type Workout } from '../domain/workout';

const workoutFiles = import.meta.glob<unknown>('./workouts/*.json', {
  eager: true,
  import: 'default',
});

const ALLOWED_TAGS = new Set([
  'endurance',
  'tempo',
  'sweetspot',
  'threshold',
  'vo2',
  'hiit',
  'sprint',
  'climb',
  'cadence',
  'test',
  'music',
  'recovery',
]);

/** Classic training repertoire: category -> workouts (explicit ids, or every workout with a tag). */
const CATEGORY: Record<string, { ids: string[] } | { tag: string }> = {
  'pyramids and ladders': {
    ids: [
      'pyramid-classic',
      'pyramid-reverse',
      'pyramid-sweet-spot',
      'ladder-up',
      'ladder-down',
      'ladder-1-2-3',
    ],
  },
  'threshold blocks': {
    ids: [
      'two-by-twenty',
      'threshold-30-steady',
      'threshold-2x15',
      'threshold-3x10',
      'four-eights',
    ],
  },
  'over-unders and criss-cross': {
    ids: [
      'over-under-classic',
      'first-over-unders',
      'over-unders-2-1',
      'criss-cross-threshold',
      'criss-cross-sweet-spot',
      'criss-cross-vo2',
    ],
  },
  'sweet spot': { tag: 'sweetspot' },
  tempo: { tag: 'tempo' },
  'long VO2 intervals': {
    ids: ['four-fours', 'vo2-5x3', 'short-threes', 'vo2-3x5', 'vo2-ramp'],
  },
  'short intervals (30-30, 30-15, 40-20, Tabata)': {
    ids: [
      'thirty-fifteen',
      'thirty-fifteen-2x10',
      'tabata-20-10',
      'forty-twenty',
      'billat-30-30',
      'gibala-10x1',
      'micro-fifteen-fifteen',
    ],
  },
  'FTP tests': { ids: ['ramp-test', 'ftp-test-20', 'ftp-test-2x8'] },
  'hill repeats': {
    ids: [
      'hill-repeats-seated',
      'hill-repeats-standing',
      'hill-long-20',
      'hill-surges',
      'standing-climbs',
    ],
  },
  'low-cadence strength': {
    ids: ['leg-strength', 'low-cadence-4x6', 'big-gear-ladder', 'torque-surges'],
  },
  'cadence drills': {
    ids: ['spin-ups-classic', 'high-cadence-endurance', 'high-cadence-drills', 'cadence-warmup'],
  },
  'sprint sets': {
    ids: [
      'sprints-6x15',
      'sprints-standing-starts',
      'sprint-steps',
      'sprint-ladder',
      'saddle-attack',
    ],
  },
  recovery: { tag: 'recovery' },
  'long zone 2': { ids: ['easy-ride-60', 'zone2-60', 'zone2-cadence-60', 'zone2-75'] },
  'music class': { tag: 'music' },
  'Zwift-style mixed': {
    ids: [
      'mixed-surges-60',
      'rolling-ramps',
      'endurance-bursts',
      'sweet-spot-and-attacks',
      'staircase',
      'waves',
    ],
  },
};

const byId = new Map(builtinWorkouts.map((w) => [w.id, w]));
const get = (id: string): Workout => {
  const w = byId.get(id);
  if (!w) throw new Error(`missing workout ${id}`);
  return w;
};

/** The hand-made demo workout predates the content design and is exempt from tag/length rules. */
const isLibrary = (w: Workout): boolean => w.id !== 'demo-mixed';

// Duration windows (seconds) for sessions that sit in plans. Default: a 45-minute session.
const DEFAULT_RANGE: [number, number] = [2400, 3000];
const QUICK_BOOST_RANGE: [number, number] = [1500, 2400];
/** Explicit exceptions to the default 45-minute window. */
const DURATION_EXCEPTIONS: Record<string, [number, number]> = {
  // Ramp test: warm-up + 25 one-minute steps + cool-down, a measurement and not a 45 minute session.
  'ramp-test': [2000, 2400],
  // Design: "Tempo z kadencją ... (35 min)".
  'tempo-cadence-3x6': [2000, 2300],
  // Seiler 4 x 8 format is a 55 minute session by design.
  'four-eights': [2400, 3300],
  'four-eights-102': [2400, 3300],
};

/** Minutes at or above 85 % FTP (segment mean), the same definition as weeklyLoad. */
function hardMinutes(w: Workout): number {
  let sec = 0;
  for (const seg of flattenWorkout(w)) {
    if ((seg.ftpPctStart + seg.ftpPctEnd) / 2 >= 85) sec += seg.durationSec;
  }
  return sec / 60;
}

/** Hard minutes plus minutes in the 80-85 % band at half weight. */
function weightedMinutes(w: Workout): number {
  let sec = 0;
  for (const seg of flattenWorkout(w)) {
    const mean = (seg.ftpPctStart + seg.ftpPctEnd) / 2;
    if (mean >= 85) sec += seg.durationSec;
    else if (mean >= 80) sec += seg.durationSec / 2;
  }
  return sec / 60;
}

const weekWorkouts = (plan: Plan, i: number): Workout[] =>
  (plan.weeks[i]?.sessions ?? []).map((x) => get(x.workoutId));
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

function sessionIds(plan: Plan): string[] {
  const ids = new Set<string>();
  for (const week of plan.weeks) {
    for (const s of week.sessions) ids.add(s.workoutId);
    if (week.progresAlt) ids.add(week.progresAlt);
  }
  return [...ids];
}

describe('built-in plans', () => {
  it('ships the four plans', () => {
    expect(builtinPlans.map((p) => p.id).sort()).toEqual([
      'back-to-form',
      'build-form',
      'keep-fit',
      'quick-boost',
    ]);
    for (const p of builtinPlans) expect(planSchema.safeParse(p).success).toBe(true);
  });

  it('has the designed number of weeks and light weeks', () => {
    const shape = Object.fromEntries(
      builtinPlans.map((p) => [p.id, p.weeks.map((w) => (w.light ? 'L' : '-')).join('')]),
    );
    expect(shape).toEqual({
      'back-to-form': '---L--',
      'build-form': '---L---L',
      'quick-boost': '---L',
      'keep-fit': '---L',
    });
  });

  it('every week has exactly one progres and one freestyle session', () => {
    for (const p of builtinPlans) {
      for (const [i, week] of p.weeks.entries()) {
        const slots = week.sessions.map((s) => s.slot).sort();
        expect(slots, `${p.id} week ${i + 1}`).toEqual(['freestyle', 'progres']);
      }
    }
  });

  it('every referenced workout exists', () => {
    for (const p of builtinPlans) {
      for (const week of p.weeks) {
        for (const s of week.sessions) expect(byId.has(s.workoutId), s.workoutId).toBe(true);
        if (week.progresAlt) expect(byId.has(week.progresAlt), week.progresAlt).toBe(true);
      }
    }
  });

  it('plan sessions fit their duration windows', () => {
    for (const p of builtinPlans) {
      const base = p.id === 'quick-boost' ? QUICK_BOOST_RANGE : DEFAULT_RANGE;
      for (const id of sessionIds(p)) {
        const [lo, hi] = DURATION_EXCEPTIONS[id] ?? base;
        const sec = totalDurationSec(get(id));
        expect(sec, `${p.id}: ${id} is ${sec}s`).toBeGreaterThanOrEqual(lo);
        expect(sec, `${p.id}: ${id} is ${sec}s`).toBeLessThanOrEqual(hi);
      }
    }
  });

  it('light weeks carry at most 75 % of the previous week hard minutes', () => {
    for (const p of builtinPlans) {
      const load = weeklyLoad(p, get);
      p.weeks.forEach((week, i) => {
        if (!week.light || i === 0) return;
        const prev = load[i - 1] ?? 0;
        const cur = load[i] ?? 0;
        expect(cur, `${p.id} week ${i + 1}: ${cur} vs ${prev}`).toBeLessThanOrEqual(prev * 0.75);
      });
    }
  });

  it('light weeks also stay light when 80-85 % time counts at half weight', () => {
    for (const p of builtinPlans) {
      p.weeks.forEach((week, i) => {
        if (!week.light || i === 0) return;
        const cur = sum(weekWorkouts(p, i).map(weightedMinutes));
        const prev = sum(weekWorkouts(p, i - 1).map(weightedMinutes));
        expect(cur, `${p.id} week ${i + 1}: ${cur} vs ${prev}`).toBeLessThanOrEqual(prev * 0.75);
      });
    }
  });

  it('no non-light week adds more than 50 % hard minutes over the previous non-light week', () => {
    for (const p of builtinPlans) {
      const load = weeklyLoad(p, get);
      let prev: number | undefined;
      p.weeks.forEach((week, i) => {
        if (week.light) return;
        const cur = load[i] ?? 0;
        if (prev !== undefined) {
          expect(cur, `${p.id} week ${i + 1}: ${cur} vs ${prev}`).toBeLessThanOrEqual(prev * 1.5);
        }
        prev = cur;
      });
    }
  });

  it('weekly hard share fits the plan level', () => {
    const limits: Record<string, [number, number] | undefined> = {
      beginner: [0.25, 0.45],
      intermediate: [0, 0.55],
      short: [0, 0.55],
    };
    for (const p of builtinPlans) {
      const range = limits[p.level];
      if (!range) continue;
      const load = weeklyLoad(p, get);
      p.weeks.forEach((week, i) => {
        if (week.light) return;
        const total = sum(weekWorkouts(p, i).map((w) => totalDurationSec(w) / 60));
        const share = (load[i] ?? 0) / total;
        const where = `${p.id} week ${i + 1}: ${share.toFixed(3)}`;
        expect(share, where).toBeGreaterThanOrEqual(range[0]);
        expect(share, where).toBeLessThanOrEqual(range[1]);
      });
    }
  });

  it('hard minutes helper agrees with weeklyLoad', () => {
    const p = builtinPlans[0];
    if (!p) throw new Error('no plans');
    const load = weeklyLoad(p, get);
    expect(sum(weekWorkouts(p, 0).map(hardMinutes))).toBeCloseTo(load[0] ?? 0, 0);
  });

  it('plans and weeks have localized text', () => {
    for (const p of builtinPlans) {
      expect(p.localized?.pl?.name).toBeTruthy();
      expect(p.localized?.en?.description).toBeTruthy();
    }
  });
});

describe('built-in workouts', () => {
  it('every workout validates and its id equals the file name', () => {
    expect(Object.keys(workoutFiles).length).toBe(builtinWorkouts.length);
    for (const [file, raw] of Object.entries(workoutFiles)) {
      const r = workoutSchema.safeParse(raw);
      expect(r.success, `${file}: ${r.success ? '' : r.error.message}`).toBe(true);
      const base = file.replace(/^.*\//, '').replace(/\.json$/, '');
      expect((raw as { id: string }).id).toBe(base);
    }
  });

  it('ids are unique', () => {
    expect(new Set(builtinWorkouts.map((w) => w.id)).size).toBe(builtinWorkouts.length);
  });

  it('ships at least 80 freestyle library workouts', () => {
    const freestyle = builtinWorkouts.filter((w) => w.category === 'freestyle' && isLibrary(w));
    expect(freestyle.length).toBeGreaterThanOrEqual(80);
  });

  it('covers every classic workout category with at least 3 workouts', () => {
    const freestyle = builtinWorkouts.filter((w) => w.category === 'freestyle' && isLibrary(w));
    const ids = new Set(freestyle.map((w) => w.id));
    for (const [category, spec] of Object.entries(CATEGORY)) {
      const members =
        'tag' in spec
          ? freestyle.filter((w) => w.tags.includes(spec.tag)).map((w) => w.id)
          : spec.ids;
      for (const id of members)
        expect(ids.has(id), `${category}: unknown workout ${id}`).toBe(true);
      expect(members.length, category).toBeGreaterThanOrEqual(3);
    }
  });

  it('plan-only sessions are progres, everything else is freestyle', () => {
    for (const w of builtinWorkouts) expect(['progres', 'freestyle']).toContain(w.category);
    const progresSlotIds = new Set(
      builtinPlans.flatMap((p) =>
        p.weeks.flatMap((wk) => [
          ...wk.sessions.filter((s) => s.slot === 'progres').map((s) => s.workoutId),
          ...(wk.progresAlt ? [wk.progresAlt] : []),
        ]),
      ),
    );
    for (const w of builtinWorkouts.filter((x) => x.category === 'progres')) {
      expect(progresSlotIds.has(w.id), `${w.id} is progres but not in a progres slot`).toBe(true);
    }
  });

  it('has localized pl and en text and allowed tags', () => {
    for (const w of builtinWorkouts.filter(isLibrary)) {
      expect(w.localized?.pl?.name, w.id).toBeTruthy();
      expect(w.localized?.pl?.description, w.id).toBeTruthy();
      expect(w.localized?.en?.name, w.id).toBe(w.name);
      expect(w.localized?.en?.description, w.id).toBe(w.description);
      expect(w.tags.length, w.id).toBeGreaterThan(0);
      for (const t of w.tags) expect(ALLOWED_TAGS.has(t), `${w.id}: tag ${t}`).toBe(true);
    }
  });

  it('declares standard warm-up and cool-down scaling', () => {
    for (const w of builtinWorkouts) {
      expect(w.scaling, w.id).toBeDefined();
      const first = w.blocks[0];
      const last = w.blocks[w.blocks.length - 1];
      expect(first?.id).toBe(w.scaling?.warmupBlockId);
      expect(last?.id).toBe(w.scaling?.cooldownBlockId);
    }
  });

  it('respects built-in rpm rules', () => {
    for (const w of builtinWorkouts) {
      for (const seg of flattenWorkout(w)) {
        if (seg.rpm === undefined) continue;
        const where = `${w.id} ${seg.blockId}`;
        expect(seg.rpm, where).toBeGreaterThanOrEqual(60);
        expect(seg.rpm, where).toBeLessThanOrEqual(115);
        if (seg.rpm > 110) expect(seg.durationSec, `${where} fast cadence`).toBeLessThanOrEqual(30);
        if (seg.position === 'standing') {
          expect(seg.rpm, `${where} standing`).toBeLessThanOrEqual(75);
        }
      }
    }
  });

  it('keeps sprints short (ramp test excluded)', () => {
    for (const w of builtinWorkouts.filter((x) => !x.tags.includes('test'))) {
      for (const seg of flattenWorkout(w)) {
        if (seg.ftpPctStart >= 140) {
          expect(seg.durationSec, `${w.id} ${seg.blockId}`).toBeLessThanOrEqual(30);
        }
      }
    }
  });

  it('scales to 30, 45 and 60 minutes without error', () => {
    for (const w of builtinWorkouts) {
      for (const targetMinutes of [30, 45, 60] as const) {
        for (const difficultyPct of [-5, 0, 5] as const) {
          const scaled = scaleWorkout(w, { targetMinutes, difficultyPct });
          expect(totalDurationSec(scaled), `${w.id} @${targetMinutes}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('scaling reaches near the 45 minute target for plan sessions with a flex repeat', () => {
    for (const id of ['sweet-spot-3x8-90', 'vo2-5x3', 'music-mayday', 'easy-ride-45']) {
      const scaled = scaleWorkout(get(id), { targetMinutes: 45, difficultyPct: 0 });
      expect(Math.abs(totalDurationSec(scaled) - 2700), id).toBeLessThanOrEqual(300);
    }
  });

  it('music templates carry hints for main blocks and no track ids', () => {
    const music = builtinWorkouts.filter((w) => w.tags.includes('music') && isLibrary(w));
    expect(
      music.filter((w) => w.musicHints && Object.keys(w.musicHints).length > 0).length,
    ).toBeGreaterThanOrEqual(5);
    for (const w of music) {
      expect(w.musicCues, w.id).toEqual([]);
      expect(w.fallbackPlaylist, w.id).toEqual([]);
      const ids = new Set(flattenWorkout(w).map((s) => s.blockId));
      for (const [blockId, text] of Object.entries(w.musicHints ?? {})) {
        expect(ids.has(blockId), `${w.id}: hint for unknown block ${blockId}`).toBe(true);
        expect(text.length).toBeGreaterThan(10);
      }
    }
  });

  it('every main block of a music workout has a BPM hint', () => {
    for (const w of builtinWorkouts.filter((x) => x.tags.includes('music'))) {
      const main = w.blocks.slice(1, -1);
      const ids = main.flatMap((b) => (b.kind === 'repeat' ? b.blocks.map((c) => c.id) : [b.id]));
      // Warm-up spin-up steady blocks are not part of the music script.
      const spin = new Set(w.blocks.filter((b) => b.id.includes('-wu')).map((b) => b.id));
      for (const id of ids.filter((x) => !spin.has(x))) {
        expect(w.musicHints?.[id], `${w.id} block ${id}`).toMatch(/BPM/);
      }
    }
  });

  it('cues and labels are known tokens', () => {
    const cues = new Set([
      'standUp',
      'sitDown',
      'sprint',
      'attack',
      'goUntilFail',
      'breathe',
      'spinUp',
      'holdIt',
      'lastOne',
    ]);
    const labels = new Set([
      'warmup',
      'cooldown',
      'recovery',
      'climb',
      'sprint',
      'steady',
      'interval',
      'test',
    ]);
    const check = (text: string | undefined, known: Set<string>, where: string): void => {
      if (text === undefined) return;
      expect(text.startsWith('@') && known.has(text.slice(1)), `${where}: ${text}`).toBe(true);
    };
    for (const w of builtinWorkouts.filter(isLibrary)) {
      for (const b of w.blocks) {
        for (const c of b.kind === 'repeat' ? b.blocks : [b]) {
          check(c.cue, cues, `${w.id} ${c.id} cue`);
          check(c.label, labels, `${w.id} ${c.id} label`);
        }
      }
    }
  });

  it('tokens exist in both dictionaries', () => {
    for (const k of [
      'standUp',
      'sitDown',
      'sprint',
      'attack',
      'goUntilFail',
      'breathe',
      'spinUp',
      'holdIt',
      'lastOne',
    ]) {
      expect(en.coach[k as keyof typeof en.coach], k).toBeTruthy();
      expect(pl.coach[k as keyof typeof pl.coach], k).toBeTruthy();
    }
    for (const k of [
      'warmup',
      'cooldown',
      'recovery',
      'climb',
      'sprint',
      'steady',
      'interval',
      'test',
    ]) {
      expect(en.block[k as keyof typeof en.block], k).toBeTruthy();
      expect(pl.block[k as keyof typeof pl.block], k).toBeTruthy();
    }
  });

  it('tabata-lite only stretches warm-up and cool-down', () => {
    const sc = get('tabata-lite').scaling;
    expect(sc?.minTimes).toBe(8);
    expect(sc?.maxTimes).toBe(8);
  });

  it('ramp test climbs 6 % per minute from 50 % for 25 steps', () => {
    const t = get('ramp-test');
    expect(t.tags).toContain('test');
    const segs = flattenWorkout(t).filter((s) => s.label === '@test');
    expect(segs.map((s) => s.ftpPctStart)).toEqual(
      Array.from({ length: 25 }, (_, i) => 50 + 6 * i),
    );
    expect(segs.every((s) => s.durationSec === 60)).toBe(true);
    expect(segs[12]?.ftpPctStart).toBe(122);
    expect(segs[12]?.cue).toBe('@goUntilFail');
  });
});
