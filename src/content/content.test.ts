import { describe, expect, it } from 'vitest';
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
  // Ramp tests are a measurement, not a 45 minute session.
  'ramp-test': [1500, 1800],
  // Design: "Tempo z kadencją ... (35 min)".
  'tempo-cadence-3x6': [2000, 2300],
  // Seiler 4 x 8 format is a 55 minute session by design.
  'four-eights': [2400, 3300],
  'four-eights-102': [2400, 3300],
};

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

  it('ships at least 45 freestyle library workouts', () => {
    const freestyle = builtinWorkouts.filter((w) => w.category === 'freestyle' && isLibrary(w));
    expect(freestyle.length).toBeGreaterThanOrEqual(45);
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

  it('ramp test climbs 6 % per minute from 50 % to the 140 % cap', () => {
    const t = get('ramp-test');
    expect(t.tags).toContain('test');
    const segs = flattenWorkout(t).filter((s) => s.label?.startsWith('Step'));
    expect(segs.map((s) => s.ftpPctStart)).toEqual(
      Array.from({ length: 16 }, (_, i) => 50 + 6 * i),
    );
    expect(segs.every((s) => s.durationSec === 60)).toBe(true);
    expect(segs[segs.length - 1]?.cue).toBe("Go until you can't!");
  });
});
