import { describe, expect, it } from 'vitest';
import { playerSchema, validatePlayers } from './player';

describe('playerSchema', () => {
  it('accepts a valid player and trims the name', () => {
    const r = playerSchema.safeParse({ id: 'p1', name: '  Ola  ', ftp: 200 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe('Ola');
  });
  it.each([0, 49, 601, 9999, 'abc', 150.5, NaN])('rejects ftp %s', (ftp) => {
    expect(playerSchema.safeParse({ id: 'p1', name: 'A', ftp }).success).toBe(false);
  });
  it('accepts ftp bounds 50 and 600', () => {
    expect(playerSchema.safeParse({ id: 'a', name: 'A', ftp: 50 }).success).toBe(true);
    expect(playerSchema.safeParse({ id: 'a', name: 'A', ftp: 600 }).success).toBe(true);
  });
  it('rejects empty, blank and too long names', () => {
    expect(playerSchema.safeParse({ id: 'a', name: '', ftp: 200 }).success).toBe(false);
    expect(playerSchema.safeParse({ id: 'a', name: '   ', ftp: 200 }).success).toBe(false);
    expect(playerSchema.safeParse({ id: 'a', name: 'x'.repeat(25), ftp: 200 }).success).toBe(false);
    expect(playerSchema.safeParse({ id: 'a', name: 'x'.repeat(24), ftp: 200 }).success).toBe(true);
  });
});

describe('validatePlayers', () => {
  const p = (id: string, isMe?: boolean) => ({ id, name: id, ftp: 200, ...(isMe ? { isMe } : {}) });
  it('allows zero or one isMe', () => {
    expect(validatePlayers([p('a'), p('b')]).ok).toBe(true);
    expect(validatePlayers([p('a', true), p('b')]).ok).toBe(true);
  });
  it('rejects two isMe', () => {
    expect(validatePlayers([p('a', true), p('b', true)]).ok).toBe(false);
  });
  it('rejects invalid items', () => {
    expect(validatePlayers([{ id: 'a', name: 'A', ftp: 0 }]).ok).toBe(false);
  });
});
