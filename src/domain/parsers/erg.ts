import { newId } from '../ids';
import type { Block } from '../workout';
import {
  parseLooseNumber,
  tooLarge,
  baseName,
  stripBom,
  clampDuration,
  clampPct,
  finishWorkout,
  intensityFromPct,
} from './build';
import type { ErgOptions, ImportResult } from './types';

type Unit = 'watts' | 'percent';

interface Header {
  values: Map<string, string>;
  unit?: Unit;
}

function parseHeader(lines: string[]): Header {
  const values = new Map<string, string>();
  let unit: Unit | undefined;
  for (const line of lines) {
    const eq = line.indexOf('=');
    if (eq >= 0) {
      values.set(line.slice(0, eq).trim().toUpperCase(), line.slice(eq + 1).trim());
      continue;
    }
    const m = /^MINUTES\s+(WATTS|PERCENT)\b/i.exec(line);
    if (m) unit = m[1]?.toUpperCase() === 'WATTS' ? 'watts' : 'percent';
  }
  return unit ? { values, unit } : { values };
}

/** Shared by ERG (default unit watts) and MRC (default unit percent). */
export function parseCourse(
  input: string,
  defaultUnit: Unit,
  opts: ErgOptions | undefined,
): ImportResult {
  const text = stripBom(input);
  if (text.trim() === '') return { ok: false, error: 'File is empty' };
  if (tooLarge(text)) return { ok: false, error: 'File too large' };

  const headerLines: string[] = [];
  const dataLines: string[] = [];
  let section: 'none' | 'header' | 'data' | 'other' = 'none';
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      const name = (sec[1] ?? '').toUpperCase();
      if (name === 'COURSE HEADER') section = 'header';
      else if (name === 'COURSE DATA') section = 'data';
      else section = 'other';
      continue;
    }
    if (section === 'header') headerLines.push(line);
    else if (section === 'data') dataLines.push(line);
  }
  if (dataLines.length === 0) return { ok: false, error: 'No [COURSE DATA] section found' };

  const header = parseHeader(headerLines);
  const unit = header.unit ?? defaultUnit;
  const warnings: string[] = [];

  let ftp: number | undefined;
  if (unit === 'watts') {
    const rawFtp = header.values.get('FTP');
    const fromHeader = parseLooseNumber(rawFtp ?? '');
    if (rawFtp !== undefined && !(Number.isFinite(fromHeader) && fromHeader > 0)) {
      warnings.push(`FTP header "${rawFtp.slice(0, 20)}" is not a valid number, ignored`);
    }
    if (Number.isFinite(fromHeader) && fromHeader > 0) ftp = fromHeader;
    else if (opts?.ftp !== undefined && Number.isFinite(opts.ftp) && opts.ftp > 0) ftp = opts.ftp;
    if (ftp === undefined) {
      return { ok: false, error: 'FTP is required to convert watts (no FTP in the file header)' };
    }
  }

  const points: { t: number; v: number }[] = [];
  for (const line of dataLines) {
    const parts = line.split(/[\s;]+/).filter((p) => p !== '');
    // Exactly two tokens: a comma is a decimal separator ("0,5\t200").
    const t = parts.length === 2 ? parseLooseNumber(parts[0] ?? '') : NaN;
    const v = parts.length === 2 ? parseLooseNumber(parts[1] ?? '') : NaN;
    if (!Number.isFinite(t) || !Number.isFinite(v) || t < 0) {
      warnings.push(`Unreadable data line skipped: "${line.slice(0, 40)}"`);
      continue;
    }
    points.push({ t, v });
  }

  const toPct = (v: number, where: string): number => {
    const raw = unit === 'watts' ? (v / (ftp ?? 1)) * 100 : v;
    return clampPct(Math.round(raw * 10) / 10, where, warnings);
  };

  const blocks: Block[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    const where = `Segment ${i + 1}`;
    if (b.t < a.t) {
      warnings.push(`${where}: time goes backwards, segment skipped`);
      continue;
    }
    if (b.t === a.t) continue; // same time: an intensity step, not a block
    const dur = Math.round(b.t * 60) - Math.round(a.t * 60);
    if (dur <= 0) {
      warnings.push(`${where}: zero-length block dropped`);
      continue;
    }
    const durationSec = clampDuration(dur, where, warnings);
    if (a.v === b.v) {
      blocks.push({
        kind: 'steady',
        id: newId(),
        durationSec,
        intensity: intensityFromPct(toPct(a.v, where)),
      });
    } else {
      blocks.push({
        kind: 'ramp',
        id: newId(),
        durationSec,
        from: intensityFromPct(toPct(a.v, where)),
        to: intensityFromPct(toPct(b.v, where)),
      });
    }
  }

  const name = header.values.get('DESCRIPTION') || header.values.get('FILE NAME') || '';
  return finishWorkout({
    name: name || baseName(opts?.fileName),
    description: '',
    blocks,
    warnings,
    opts,
  });
}

export function parseErg(text: string, opts?: ErgOptions): ImportResult {
  return parseCourse(text, 'watts', opts);
}
