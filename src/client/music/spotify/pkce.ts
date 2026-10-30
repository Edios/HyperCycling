/** RFC 7636 unreserved characters (66), the alphabet allowed in a code verifier. */
const UNRESERVED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
/** Largest multiple of the alphabet size that fits in a byte; larger bytes are rejected (no modulo bias). */
const ACCEPT_BELOW = 256 - (256 % UNRESERVED.length);

export const VERIFIER_LENGTH = 64;

export type RandomBytes = (length: number) => Uint8Array;

const cryptoRandomBytes: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

/** Cryptographically random string of `length` unreserved characters. */
export function randomString(length: number, randomBytes: RandomBytes = cryptoRandomBytes): string {
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < ACCEPT_BELOW && out.length < length) {
        out += UNRESERVED.charAt(byte % UNRESERVED.length);
      }
    }
  }
  return out;
}

export const generateVerifier = (randomBytes?: RandomBytes): string =>
  randomString(VERIFIER_LENGTH, randomBytes);

export const generateState = (randomBytes?: RandomBytes): string => randomString(32, randomBytes);

export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** `code_challenge` for method S256: BASE64URL(SHA-256(verifier)). */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}
