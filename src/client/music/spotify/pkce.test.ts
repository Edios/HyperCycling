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
    // 256 - 256 % 66 = 198: bytes 198..255 are rejected, 197 is the last one accepted.
    const bytes = [255, 254, 199, 198, 197, 0, 1, 2];
    let call = 0;
    const out = randomString(4, () => {
      call++;
      return Uint8Array.from(bytes);
    });
    expect(out).toBe('~ABC'); // 197 % 66 = 65 -> '~'
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
