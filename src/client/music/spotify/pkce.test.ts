import { describe, expect, it } from 'vitest';
import { base64Url, challengeFor, generateState, generateVerifier, randomString } from './pkce';

describe('code verifier', () => {
  it('is 64 characters from the RFC 7636 unreserved alphabet', () => {
    const v = generateVerifier();
    expect(v).toHaveLength(64);
    expect(v).toMatch(/^[A-Za-z0-9\-._~]{64}$/);
  });
  it('differs between calls', () => {
    expect(generateVerifier()).not.toBe(generateVerifier());
    expect(generateState()).not.toBe(generateState());
  });
  it('skips random bytes that would bias the alphabet', () => {
    // 252..255 are rejected (252 = 66 * 3 + 54); only the 0-byte after them is used.
    const bytes = [255, 254, 253, 252, 0, 1, 2, 3];
    let call = 0;
    const out = randomString(3, () => {
      call++;
      return Uint8Array.from(bytes.concat(bytes));
    });
    expect(out).toBe('ABC');
    expect(call).toBe(1);
  });
});

describe('code challenge (S256)', () => {
  it('matches the RFC 7636 appendix B vector', async () => {
    expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
  it('is unpadded base64url', async () => {
    const c = await challengeFor(generateVerifier());
    expect(c).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(base64Url(Uint8Array.from([251, 255, 254]))).toBe('-__-');
  });
});
