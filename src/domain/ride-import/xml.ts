/**
 * Shared XML handling for the TCX and GPX readers: one safe parse (no DOCTYPE, no entity
 * expansion) into a tree where every element is an array, and small helpers that find elements by
 * their local name, whatever namespace prefix a device used (`gpxtpx:hr`, `ns3:Watts`, `hr`).
 */

import { XMLParser, XMLValidator } from 'fast-xml-parser';

/** An element: its attributes (`@_name`), its text (`#text`) and its children (always arrays). */
export type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // Entity expansion is off (billion-laughs defence); numbers and times need none.
  processEntities: false,
  // Every element is a list, so one track point and a thousand read the same way.
  isArray: (_name, _path, _leaf, isAttribute) => !isAttribute,
});

/** The document root, or undefined when the text is not well-formed XML (or has a DOCTYPE). */
export function parseXml(text: string): XmlNode | undefined {
  const body = text.replace(/^\uFEFF/, '');
  if (/<!DOCTYPE/i.test(body.slice(0, 4096))) return undefined;
  if (XMLValidator.validate(body) !== true) return undefined;
  const doc = parser.parse(body) as unknown;
  return typeof doc === 'object' && doc !== null ? (doc as XmlNode) : undefined;
}

function asNode(v: unknown): XmlNode | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as XmlNode) : undefined;
}

/** Child elements with this local name (case-insensitive). */
export function children(node: XmlNode | undefined, name: string): XmlNode[] {
  if (!node) return [];
  const lower = name.toLowerCase();
  const out: XmlNode[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('@_') || key === '#text' || key.toLowerCase() !== lower) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      // A leaf element is parsed as its bare text; give it the same shape as the others.
      out.push(asNode(item) ?? { '#text': item });
    }
  }
  return out;
}

export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return children(node, name)[0];
}

/** The text of an element (trimmed), or undefined when it is empty or missing. */
export function textOf(node: XmlNode | undefined): string | undefined {
  const t = node?.['#text'];
  if (t === undefined || t === null) return undefined;
  const s = String(t).trim();
  return s === '' ? undefined : s;
}

export function attr(node: XmlNode | undefined, name: string): string | undefined {
  const v = node?.[`@_${name}`];
  return v === undefined ? undefined : String(v);
}

/** A finite number from text, or undefined. */
export function numberOf(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

/** The number in the first element (at any depth) with one of these local names. */
export function deepNumber(
  node: XmlNode | undefined,
  names: readonly string[],
): number | undefined {
  if (!node) return undefined;
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  const stack: XmlNode[] = [node];
  while (stack.length > 0) {
    const cur = stack.shift() as XmlNode;
    for (const key of Object.keys(cur)) {
      if (key.startsWith('@_') || key === '#text') continue;
      for (const kid of children(cur, key)) {
        if (wanted.has(key.toLowerCase())) {
          const n = numberOf(textOf(kid));
          if (n !== undefined) return n;
        }
        stack.push(kid);
      }
    }
  }
  return undefined;
}

/** Unix ms of an ISO 8601 time, or undefined. */
export function timeOf(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const t = Date.parse(text);
  return Number.isFinite(t) ? t : undefined;
}
