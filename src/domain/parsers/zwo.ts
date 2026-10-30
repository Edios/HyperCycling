import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { newId } from '../ids';
import type { Block, RampBlock, SteadyBlock } from '../workout';
import {
  stripBom,
  clampDuration,
  clampPct,
  clampRpm,
  finishWorkout,
  intensityFromPct,
} from './build';
import type { ImportResult, ParseOptions } from './types';

interface XNode {
  tag: string;
  attrs: Map<string, string>;
  children: XNode[];
  text: string;
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
});

/** Loose shape of fast-xml-parser's preserveOrder output. */
type RawNode = Record<string, unknown>;

function toNodes(raw: unknown): XNode[] {
  if (!Array.isArray(raw)) return [];
  const out: XNode[] = [];
  for (const item of raw as RawNode[]) {
    const tag = Object.keys(item).find((k) => k !== ':@');
    if (tag === undefined || tag === '#text') continue;
    const attrs = new Map<string, string>();
    const rawAttrs = item[':@'];
    if (rawAttrs && typeof rawAttrs === 'object') {
      for (const [k, v] of Object.entries(rawAttrs as Record<string, unknown>)) {
        attrs.set(k.replace(/^@_/, '').toLowerCase(), String(v));
      }
    }
    const kids = item[tag];
    let text = '';
    if (Array.isArray(kids)) {
      for (const k of kids as RawNode[]) {
        const t = k['#text'];
        if (t !== undefined) text += String(t);
      }
    }
    out.push({ tag, attrs, children: toNodes(kids), text: text.trim() });
  }
  return out;
}

function num(node: XNode, name: string): number | undefined {
  const raw = node.attrs.get(name.toLowerCase());
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function firstCue(node: XNode): string | undefined {
  for (const c of node.children) {
    if (c.tag.toLowerCase() === 'textevent') {
      const msg = c.attrs.get('message')?.trim();
      if (msg) return msg;
    }
  }
  return undefined;
}

/** Zwift power is a fraction of FTP. Returns %FTP, or null (with a warning) when unusable. */
function powerToPct(
  raw: number | undefined,
  where: string,
  attr: string,
  warnings: string[],
): number | null {
  if (raw === undefined) {
    warnings.push(`${where}: missing ${attr}, block skipped`);
    return null;
  }
  if (raw > 3) {
    warnings.push(`${where}: ${attr}=${raw} power looks like watts, block skipped`);
    return null;
  }
  if (raw < 0) {
    warnings.push(`${where}: negative ${attr}, block skipped`);
    return null;
  }
  return clampPct(Math.round(raw * 1000) / 10, where, warnings);
}

function durationOf(node: XNode, attr: string, where: string, warnings: string[]): number | null {
  const raw = num(node, attr);
  if (raw === undefined) {
    warnings.push(`${where}: missing ${attr}, block skipped`);
    return null;
  }
  const sec = Math.round(raw);
  if (sec <= 0) {
    warnings.push(`${where}: zero-length block dropped`);
    return null;
  }
  return clampDuration(sec, where, warnings);
}

function cadence(node: XNode, attr: string, where: string, warnings: string[]): number | undefined {
  const raw = num(node, attr);
  return raw === undefined || raw <= 0 ? undefined : clampRpm(raw, where, warnings);
}

interface Extras {
  rpm?: number | undefined;
  cue?: string | undefined;
  label?: string | undefined;
}

function steady(durationSec: number, intensity: SteadyBlock['intensity'], x: Extras): SteadyBlock {
  const b: SteadyBlock = { kind: 'steady', id: newId(), durationSec, intensity };
  if (x.rpm !== undefined) b.rpm = x.rpm;
  if (x.cue !== undefined) b.cue = x.cue;
  if (x.label !== undefined) b.label = x.label;
  return b;
}

function convertBlock(node: XNode, index: number, warnings: string[]): Block[] {
  const where = `${node.tag} #${index + 1}`;
  const cue = firstCue(node);
  switch (node.tag.toLowerCase()) {
    case 'warmup':
    case 'cooldown':
    case 'ramp': {
      const dur = durationOf(node, 'Duration', where, warnings);
      if (dur === null) return [];
      const low = powerToPct(num(node, 'PowerLow'), where, 'PowerLow', warnings);
      const high = powerToPct(num(node, 'PowerHigh'), where, 'PowerHigh', warnings);
      if (low === null || high === null) return [];
      const rpm = cadence(node, 'Cadence', where, warnings);
      if (low === high) return [steady(dur, intensityFromPct(low), { rpm, cue })];
      const ramp: RampBlock = {
        kind: 'ramp',
        id: newId(),
        durationSec: dur,
        from: intensityFromPct(low),
        to: intensityFromPct(high),
      };
      if (rpm !== undefined) ramp.rpm = rpm;
      if (cue !== undefined) ramp.cue = cue;
      return [ramp];
    }
    case 'steadystate': {
      const dur = durationOf(node, 'Duration', where, warnings);
      if (dur === null) return [];
      const pct = powerToPct(num(node, 'Power'), where, 'Power', warnings);
      if (pct === null) return [];
      return [
        steady(dur, intensityFromPct(pct), { rpm: cadence(node, 'Cadence', where, warnings), cue }),
      ];
    }
    case 'freeride': {
      const dur = durationOf(node, 'Duration', where, warnings);
      if (dur === null) return [];
      const rpm = cadence(node, 'Cadence', where, warnings);
      return [steady(dur, intensityFromPct(60), { rpm, cue, label: 'Free ride' })];
    }
    case 'maxeffort': {
      const dur = durationOf(node, 'Duration', where, warnings);
      if (dur === null) return [];
      const rpm = cadence(node, 'Cadence', where, warnings);
      return [steady(dur, { effort: 10 }, { rpm, cue, label: 'Max effort' })];
    }
    case 'intervalst': {
      const rawTimes = num(node, 'Repeat');
      if (rawTimes === undefined) {
        warnings.push(`${where}: missing Repeat, block skipped`);
        return [];
      }
      let times = Math.round(rawTimes);
      if (times < 1) {
        warnings.push(`${where}: Repeat must be at least 1, block skipped`);
        return [];
      }
      if (times > 50) {
        warnings.push(`${where}: Repeat ${times} is too high, clamped to 50`);
        times = 50;
      }
      const onSec = durationOf(node, 'OnDuration', where, warnings);
      const offSec = durationOf(node, 'OffDuration', where, warnings);
      const onPct =
        onSec === null ? null : powerToPct(num(node, 'OnPower'), where, 'OnPower', warnings);
      const offPct =
        offSec === null ? null : powerToPct(num(node, 'OffPower'), where, 'OffPower', warnings);
      const children: SteadyBlock[] = [];
      if (onSec !== null && onPct !== null) {
        children.push(
          steady(onSec, intensityFromPct(onPct), {
            rpm: cadence(node, 'Cadence', where, warnings),
            cue,
          }),
        );
      }
      if (offSec !== null && offPct !== null) {
        children.push(
          steady(offSec, intensityFromPct(offPct), {
            rpm: cadence(node, 'CadenceResting', where, warnings),
          }),
        );
      }
      if (children.length === 0) return [];
      if (times === 1) return children;
      return [{ kind: 'repeat', id: newId(), times, blocks: children }];
    }
    default:
      warnings.push(`Unknown element <${node.tag}> skipped`);
      return [];
  }
}

export function parseZwo(xml: string, opts?: ParseOptions): ImportResult {
  const text = stripBom(xml);
  if (text.trim() === '') return { ok: false, error: 'File is empty' };
  const valid = XMLValidator.validate(text);
  if (valid !== true) return { ok: false, error: `Malformed XML: ${valid.err.msg}` };
  const roots = toNodes(parser.parse(text));
  const root = roots.find((n) => n.tag.toLowerCase() === 'workout_file');
  if (!root) return { ok: false, error: 'Not a Zwift workout file (missing <workout_file>)' };

  const warnings: string[] = [];
  const child = (name: string): XNode | undefined =>
    root.children.find((n) => n.tag.toLowerCase() === name);
  const workoutNode = child('workout');
  const blocks: Block[] = [];
  workoutNode?.children.forEach((node, i) => {
    blocks.push(...convertBlock(node, i, warnings));
  });
  return finishWorkout({
    name: child('name')?.text ?? '',
    description: child('description')?.text ?? '',
    blocks,
    warnings,
    opts,
  });
}
