import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { totalDurationSec, workoutSchema, type Block } from '../workout';
import { parseErg } from './erg';
import { parseMrc } from './mrc';
import type { ImportResult } from './types';
import { parseZwo } from './zwo';

const fixture = (name: string): string =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');

const NOW = new Date('2026-01-02T03:04:05.000Z');

function okResult(r: ImportResult): { blocks: Block[]; warnings: string[]; name: string } {
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
  expect(workoutSchema.safeParse(r.workout).success).toBe(true);
  return { blocks: r.workout.blocks, warnings: r.warnings, name: r.workout.name };
}

describe('parseZwo', () => {
  it('maps every block type of a normal file', () => {
    const r = parseZwo(fixture('normal.zwo'), { fileName: 'normal.zwo', now: NOW });
    if (!r.ok) throw new Error(r.error);
    const w = r.workout;
    expect(w.name).toBe('Test Ladder');
    expect(w.description).toContain('Original fixture');
    expect(w.category).toBe('freestyle');
    expect(w.tags).toEqual([]);
    expect(w.source).toEqual({ kind: 'import', file: 'normal.zwo' });
    expect(w.musicCues).toEqual([]);
    expect(w.fallbackPlaylist).toEqual([]);
    expect(w.scaling).toBeUndefined();
    expect(w.schemaVersion).toBe(1);
    expect(w.updatedAt).toBe(NOW.toISOString());
    expect(r.warnings).toEqual([]);
    expect(w.blocks).toHaveLength(6);
    expect(totalDurationSec(w)).toBe(1680);

    const [warm, steady, rep, ramp, free, cool] = w.blocks;
    expect(warm).toMatchObject({
      kind: 'ramp',
      durationSec: 300,
      from: { ftpPct: 40 },
      to: { ftpPct: 75 },
      rpm: 90,
      cue: 'Easy start',
    });
    expect(steady).toMatchObject({
      kind: 'steady',
      durationSec: 240,
      intensity: { ftpPct: 80 },
      rpm: 85,
    });
    expect(rep).toMatchObject({ kind: 'repeat', times: 4 });
    if (rep?.kind !== 'repeat') throw new Error('repeat expected');
    expect(rep.blocks).toMatchObject([
      { durationSec: 60, intensity: { ftpPct: 110 }, rpm: 100 },
      { durationSec: 90, intensity: { ftpPct: 50 }, rpm: 80 },
    ]);
    expect(ramp).toMatchObject({
      kind: 'ramp',
      durationSec: 180,
      from: { ftpPct: 60 },
      to: { ftpPct: 90 },
    });
    expect(free).toMatchObject({
      kind: 'steady',
      durationSec: 120,
      intensity: { ftpPct: 60 },
      label: 'Free ride',
    });
    expect(cool).toMatchObject({
      kind: 'ramp',
      durationSec: 240,
      from: { ftpPct: 70 },
      to: { ftpPct: 40 },
    });
  });

  it('omits rpm when the file has no cadence', () => {
    const r = okResult(parseZwo(fixture('normal.zwo')));
    const ramp = r.blocks[3];
    expect(ramp && 'rpm' in ramp).toBe(false);
  });

  it('maps MaxEffort to effort 10', () => {
    const r = okResult(
      parseZwo(
        '<workout_file><name>x</name><workout><MaxEffort Duration="20"/></workout></workout_file>',
      ),
    );
    expect(r.blocks[0]).toMatchObject({
      kind: 'steady',
      durationSec: 20,
      intensity: { effort: 10 },
    });
  });

  it('survives a messy file and reports warnings (Review Focus #2)', () => {
    const r = parseZwo(fixture('messy.zwo'), { now: NOW });
    const { blocks, warnings } = okResult(r);
    expect(blocks).toHaveLength(5);
    expect(blocks.map((b) => (b.kind === 'steady' ? b.durationSec : -1))).toEqual([
      120, 90, 60, 30, 30,
    ]);
    expect(blocks[1]).toMatchObject({ rpm: 150 });
    expect(blocks[2]).toMatchObject({ kind: 'steady', intensity: { ftpPct: 70 } });
    expect(warnings.some((w) => /zero-length/i.test(w))).toBe(true);
    expect(warnings.some((w) => w.includes('<Mystery>'))).toBe(true);
    expect(warnings.some((w) => /looks like watts/.test(w))).toBe(true);
    expect(warnings.some((w) => /cadence 200/.test(w))).toBe(true);
  });

  it('returns an error for malformed XML', () => {
    const r = parseZwo(fixture('malformed.zwo'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/malformed/i);
  });

  it('returns an error for an empty file', () => {
    expect(parseZwo(fixture('empty.zwo')).ok).toBe(false);
    expect(parseZwo('   \n').ok).toBe(false);
  });

  it('errors when there are no blocks', () => {
    const r = parseZwo('<workout_file><name>x</name><workout></workout></workout_file>');
    expect(r).toEqual({ ok: false, error: 'No workout blocks found' });
    const r2 = parseZwo('<workout_file><name>x</name></workout_file>');
    expect(r2).toEqual({ ok: false, error: 'No workout blocks found' });
    const r3 = parseZwo(
      '<workout_file><workout><SteadyState Duration="0" Power="0.5"/></workout></workout_file>',
    );
    expect(r3).toEqual({ ok: false, error: 'No workout blocks found' });
  });

  it('rejects a non-Zwift XML document', () => {
    expect(parseZwo('<html><body/></html>').ok).toBe(false);
  });

  it('falls back to the file name when <name> is missing', () => {
    const r = okResult(
      parseZwo(
        '<workout_file><workout><SteadyState Duration="60" Power="0.5"/></workout></workout_file>',
        {
          fileName: 'Sweet Spot.zwo',
        },
      ),
    );
    expect(r.name).toBe('Sweet Spot');
    const anon = okResult(
      parseZwo(
        '<workout_file><workout><SteadyState Duration="60" Power="0.5"/></workout></workout_file>',
      ),
    );
    expect(anon.name).toBe('Imported workout');
  });

  it('clamps extreme values and bad repeats with warnings', () => {
    const xml = `<workout_file><name>${'n'.repeat(120)}</name><workout>
      <SteadyState Duration="99999" Power="0.01"/>
      <SteadyState Duration="60" Power="2.9"/>
      <SteadyState Duration="60" Power="-1"/>
      <SteadyState Duration="60"/>
      <SteadyState Power="0.5"/>
      <SteadyState Duration="60" Power="0.5" Cadence="10"/>
      <IntervalsT Repeat="99" OnDuration="10" OffDuration="10" OnPower="1" OffPower="0.5"/>
      <IntervalsT OnDuration="10" OffDuration="10" OnPower="1" OffPower="0.5"/>
      <IntervalsT Repeat="0" OnDuration="10" OffDuration="10" OnPower="1" OffPower="0.5"/>
      <IntervalsT Repeat="3" OnDuration="0" OffDuration="0" OnPower="1" OffPower="0.5"/>
      <IntervalsT Repeat="3" OnDuration="20" OffDuration="0" OnPower="1" OffPower="0.5"/>
      <IntervalsT Repeat="3" OnDuration="20" OffDuration="20" OnPower="300" OffPower="0.5"/>
      <Ramp Duration="60" PowerLow="0.5"/>
      <Warmup Duration="60" PowerLow="0.5" PowerHigh="0.8">
        <textevent message="  "/>
      </Warmup>
      <MaxEffort Duration="0"/>
      <FreeRide Duration="0"/>
    </workout></workout_file>`;
    const { blocks, warnings, name } = okResult(parseZwo(xml));
    expect(name).toHaveLength(80);
    expect(blocks[0]).toMatchObject({ durationSec: 14400, intensity: { ftpPct: 20 } });
    expect(blocks[1]).toMatchObject({ intensity: { ftpPct: 200 } });
    expect(blocks[2]).toMatchObject({ rpm: 30 });
    expect(blocks[3]).toMatchObject({ kind: 'repeat', times: 50 });
    // Repeat with zero-length "off": only the "on" child remains.
    expect(blocks[4]).toMatchObject({ kind: 'repeat', times: 3 });
    if (blocks[4]?.kind === 'repeat') expect(blocks[4].blocks).toHaveLength(1);
    expect(warnings.length).toBeGreaterThan(8);
  });

  it('never throws on odd but well-formed input', () => {
    const odd = [
      '<workout_file/>',
      '<workout_file><workout/></workout_file>',
      '<?xml version="1.0"?><workout_file><workout><!-- c --><Warmup/></workout></workout_file>',
      '﻿<workout_file><workout><SteadyState Duration="abc" Power="x"/></workout></workout_file>',
    ];
    for (const x of odd) expect(() => parseZwo(x)).not.toThrow();
    for (const x of odd) expect(parseZwo(x).ok).toBe(false);
  });
});

describe('parseErg', () => {
  it('converts watts with the FTP from the header; same-time points are steps', () => {
    const r = parseErg(fixture('watts-ftp.erg'), { fileName: 'watts-ftp.erg', now: NOW });
    if (!r.ok) throw new Error(r.error);
    expect(r.workout.name).toBe('Watts With FTP');
    expect(r.workout.source).toEqual({ kind: 'import', file: 'watts-ftp.erg' });
    expect(r.workout.blocks).toMatchObject([
      { kind: 'steady', durationSec: 300, intensity: { ftpPct: 50 } },
      { kind: 'steady', durationSec: 300, intensity: { ftpPct: 75 } },
      { kind: 'ramp', durationSec: 300, from: { ftpPct: 50 }, to: { ftpPct: 100 } },
    ]);
    expect(workoutSchema.safeParse(r.workout).success).toBe(true);
  });

  it('errors on watts without FTP and accepts opts.ftp', () => {
    const text = fixture('watts-no-ftp.erg');
    const bad = parseErg(text);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/FTP/);
    const good = okResult(parseErg(text, { ftp: 250 }));
    expect(good.blocks[0]).toMatchObject({ intensity: { ftpPct: 40 } });
    expect(good.name).toBe('Watts Without FTP');
  });

  it('prefers the header FTP over opts.ftp', () => {
    const r = okResult(parseErg(fixture('watts-ftp.erg'), { ftp: 400 }));
    expect(r.blocks[0]).toMatchObject({ intensity: { ftpPct: 50 } });
  });

  it('handles percent ERG files, CRLF and junk lines', () => {
    const text = [
      '[COURSE HEADER]',
      'MINUTES PERCENT',
      '[END COURSE HEADER]',
      '[COURSE DATA]',
      '0 60',
      'garbage',
      '1.5 60',
      '1 70',
      '2.0000001 70',
      '2.00001 400',
      '[END COURSE DATA]',
    ].join('\r\n');
    const { blocks, warnings, name } = okResult(parseErg(text, { fileName: 'dir/my ride.erg' }));
    expect(name).toBe('my ride');
    expect(warnings.some((w) => /unreadable/i.test(w))).toBe(true);
    expect(warnings.some((w) => /backwards/i.test(w))).toBe(true);
    expect(warnings.some((w) => /zero-length/i.test(w))).toBe(true);
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('clamps out-of-range watts and errors on empty or data-less input', () => {
    const text =
      '[COURSE HEADER]\nFTP = 100\nMINUTES WATTS\n[END COURSE HEADER]\n[COURSE DATA]\n0 1000\n1 1000\n[END COURSE DATA]';
    const r = parseErg(text);
    const { blocks, warnings } = okResult(r);
    expect(blocks[0]).toMatchObject({ intensity: { ftpPct: 200 } });
    expect(warnings.some((w) => /clamped/.test(w))).toBe(true);
    expect(parseErg('').ok).toBe(false);
    expect(parseErg('hello world').ok).toBe(false);
    const single =
      '[COURSE HEADER]\nFTP=200\nMINUTES WATTS\n[COURSE DATA]\n0 100\n[END COURSE DATA]';
    expect(parseErg(single)).toEqual({ ok: false, error: 'No workout blocks found' });
  });
});

describe('hardening', () => {
  const laughs = `<?xml version="1.0"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<workout_file><name>&lol3;</name><workout><SteadyState Duration="60" Power="0.5"/></workout></workout_file>`;

  it('rejects DOCTYPE and ENTITY declarations (billion laughs)', () => {
    expect(parseZwo(laughs)).toEqual({ ok: false, error: 'DOCTYPE/entities not supported' });
    expect(parseZwo('<!entity x "y"><workout_file/>')).toEqual({
      ok: false,
      error: 'DOCTYPE/entities not supported',
    });
  });

  it('decodes the standard XML entities itself', () => {
    const r = okResult(
      parseZwo(
        '<workout_file><name>A &amp; B &#65;&#x42; &bogus;</name><workout><SteadyState Duration="60" Power="0.5"><textevent message="x &lt; y"/></SteadyState></workout></workout_file>',
      ),
    );
    expect(r.name).toBe('A & B AB &bogus;');
    expect(r.blocks[0]).toMatchObject({ cue: 'x < y' });
  });

  it('accepts comma decimals in ERG data and zwo attributes', () => {
    const erg = '[COURSE HEADER]\nMINUTES PERCENT\n[COURSE DATA]\n0,5\t50\n1;50\n[END COURSE DATA]';
    const r = okResult(parseErg(erg));
    expect(r.blocks).toMatchObject([
      { kind: 'steady', durationSec: 30, intensity: { ftpPct: 50 } },
    ]);
    const z = okResult(
      parseZwo(
        '<workout_file><workout><SteadyState Duration="60" Power="0,5"/></workout></workout_file>',
      ),
    );
    expect(z.blocks[0]).toMatchObject({ intensity: { ftpPct: 50 } });
  });

  it('skips data lines with too many tokens or ambiguous commas', () => {
    const erg = '[COURSE DATA]\n0 50 7\n1,5,6\n0 50\n1 50\n[END COURSE DATA]';
    const r = okResult(parseMrc(erg));
    expect(r.warnings.filter((w) => /unreadable/i.test(w))).toHaveLength(2);
    expect(r.blocks).toHaveLength(1);
  });

  it('rejects files over 2 MB in every parser', () => {
    const big = ' '.repeat(2 * 1024 * 1024 + 1) + 'x';
    for (const r of [parseZwo(big), parseErg(big), parseMrc(big)]) {
      expect(r).toEqual({ ok: false, error: 'File too large' });
    }
  });

  it('rejects more than 2000 blocks', () => {
    const steps = Array.from({ length: 2001 }, () => '<SteadyState Duration="5" Power="0.5"/>');
    const xml = `<workout_file><workout>${steps.join('')}</workout></workout_file>`;
    expect(parseZwo(xml)).toEqual({ ok: false, error: 'Too many blocks' });
    const lines = Array.from({ length: 2002 }, (_, i) => `${i} ${i % 2 ? 50 : 60}`);
    const mrc = `[COURSE DATA]\n${lines.join('\n')}\n[END COURSE DATA]`;
    expect(parseMrc(mrc)).toEqual({ ok: false, error: 'Too many blocks' });
    const ok = `<workout_file><workout>${steps.slice(0, 2000).join('')}</workout></workout_file>`;
    expect(parseZwo(ok).ok).toBe(true);
  });

  it('truncates long text values and dedupes warnings', () => {
    const xml = `<workout_file><name>x</name><description>${'d'.repeat(5000)}</description><workout>
      <SteadyState Duration="60" Power="0.5"><textevent message="${'c'.repeat(1000)}"/></SteadyState>
      <FreeRide Duration="30"><textevent message="${'q'.repeat(1000)}"/></FreeRide>
      ${'<Mystery/>'.repeat(5)}
    </workout></workout_file>`;
    const r = parseZwo(xml, { fileName: 'f'.repeat(400) + '.zwo' });
    if (!r.ok) throw new Error(r.error);
    expect(r.workout.description.length).toBeLessThanOrEqual(2000);
    expect(r.workout.source.file?.length).toBeLessThanOrEqual(255);
    const [a, b] = r.workout.blocks;
    expect(a && 'cue' in a ? a.cue?.length : 0).toBe(200);
    expect(b && 'cue' in b ? b.cue?.length : 0).toBe(200);
    expect(r.warnings.filter((w) => w.includes('<Mystery>'))).toHaveLength(1);
  });

  it('caps the number of warnings', () => {
    const junk = Array.from({ length: 80 }, (_, i) => `junk${i}`).join('\n');
    const r = okResult(parseMrc(`[COURSE DATA]\n${junk}\n0 50\n1 50\n[END COURSE DATA]`));
    expect(r.warnings).toHaveLength(51);
    expect(r.warnings.at(-1)).toMatch(/more warnings/);
  });

  it('warns when the FTP header is unreadable', () => {
    const erg =
      '[COURSE HEADER]\nFTP = abc\nMINUTES WATTS\n[COURSE DATA]\n0 100\n1 100\n[END COURSE DATA]';
    const r = parseErg(erg, { ftp: 200 });
    const { warnings } = okResult(r);
    expect(warnings.some((w) => /FTP header/.test(w))).toBe(true);
  });
});

describe('parseMrc', () => {
  it('maps a percent course', () => {
    const r = okResult(parseMrc(fixture('percent.mrc'), { fileName: 'percent.mrc' }));
    expect(r.name).toBe('Percent Course');
    expect(r.blocks).toMatchObject([
      { kind: 'steady', durationSec: 600, intensity: { ftpPct: 50 } },
      { kind: 'steady', durationSec: 600, intensity: { ftpPct: 75 } },
      { kind: 'steady', durationSec: 30, intensity: { ftpPct: 120 } },
    ]);
  });

  it('assumes percent when the header does not say', () => {
    const r = okResult(parseMrc('[COURSE DATA]\n0 50\n2 80\n[END COURSE DATA]'));
    expect(r.blocks[0]).toMatchObject({ kind: 'ramp', from: { ftpPct: 50 }, to: { ftpPct: 80 } });
  });
});
