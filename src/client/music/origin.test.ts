import { describe, expect, it } from 'vitest';
import { ipOriginHost, isIpHost } from './origin';

describe('isIpHost', () => {
  it.each(['127.0.0.1', '192.168.1.20', '10.0.0.5', '[::1]', '::1', '[2001:db8::1]'])(
    '%s is an IP address',
    (h) => expect(isIpHost(h)).toBe(true),
  );
  it.each(['localhost', 'hypercycling.app', 'pages.example.io', 'my-pc.local', '127.0.0.1.nip.io'])(
    '%s is not',
    (h) => expect(isIpHost(h)).toBe(false),
  );
});

describe('ipOriginHost', () => {
  it('gives the host only for an IP address', () => {
    expect(ipOriginHost({ hostname: '127.0.0.1' })).toBe('127.0.0.1');
    expect(ipOriginHost({ hostname: 'localhost' })).toBeUndefined();
  });
});
