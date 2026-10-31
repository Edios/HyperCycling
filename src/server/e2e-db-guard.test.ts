import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSafeE2eDbPath } from './e2e-db-guard';

const root = path.resolve('/repo');

describe('assertSafeE2eDbPath', () => {
  it('accepts a database in the OS temp dir', () => {
    const p = path.resolve('/tmp/spinning-tutor-e2e-1.db');
    expect(assertSafeE2eDbPath(p, root)).toBe(p);
  });
  it('rejects the real database', () => {
    expect(() => assertSafeE2eDbPath('data/spinning-tutor.db', root)).toThrow(/data/);
    expect(() => assertSafeE2eDbPath(path.join(root, 'data', 'spinning-tutor.db'), root)).toThrow();
  });
  it('rejects anything under data/, including backups and the folder itself', () => {
    expect(() => assertSafeE2eDbPath('./data/backups/x.db', root)).toThrow();
    expect(() => assertSafeE2eDbPath('data', root)).toThrow();
    expect(() => assertSafeE2eDbPath('data/../data/x.db', root)).toThrow();
  });
  it('does not mistake a sibling such as data-e2e for data/', () => {
    expect(() => assertSafeE2eDbPath('data-e2e/x.db', root)).not.toThrow();
  });
});
