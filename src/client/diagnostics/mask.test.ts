import { describe, expect, it } from 'vitest';
import { maskSensitive, safeSettingsSnapshot } from './mask';

describe('maskSensitive', () => {
  it('hides tokens and keys in query strings and headers', () => {
    const out = maskSensitive(
      'GET /cb?code=abc123def&access_token=SECRET1&state=x Authorization: Bearer eyJhbGciOi.payload.sig',
    );
    expect(out).not.toContain('abc123def');
    expect(out).not.toContain('SECRET1');
    expect(out).not.toContain('eyJhbGciOi.payload.sig');
    expect(out).toContain('state=x');
  });

  it('hides private playlist links but keeps the provider visible', () => {
    const out = maskSensitive(
      'open https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=1 and https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdef123456 and spotify:playlist:37i9dQZF1DX',
    );
    expect(out).not.toContain('37i9dQZF1DXcBWIGoYBM5M');
    expect(out).not.toContain('PLabcdef123456');
    expect(out).not.toContain('spotify:playlist:37i9dQZF1DX');
    expect(out).toContain('open.spotify.com/playlist/');
    expect(out).toContain('v=dQw4w9WgXcQ');
  });

  it('hides long secret-looking strings and key=value secrets', () => {
    const out = maskSensitive('apiKey: 0123456789abcdef0123456789abcdef client_secret=zzz9');
    expect(out).not.toContain('0123456789abcdef0123456789abcdef');
    expect(out).not.toContain('zzz9');
  });

  it('leaves ordinary text alone', () => {
    const text = '12:00:01 trainer rx 0A 1B 2C | played #0 youtube:dQw4w9WgXcQ Song';
    expect(maskSensitive(text)).toBe(text);
  });
});

describe('safeSettingsSnapshot', () => {
  it('drops credentials and private links, keeps the rest', () => {
    const snap = safeSettingsSnapshot({
      lang: 'pl',
      sounds: true,
      getSongBpmKey: 'k',
      spotify: { clientId: 'cid', accessToken: 'a', refreshToken: 'r', expiresAt: 1 },
      lastSession: { youtubeUrl: 'https://youtube.com/playlist?list=PLsecret', music: true },
    });
    const text = JSON.stringify(snap);
    expect(text).toContain('"lang":"pl"');
    expect(text).toContain('"music":true');
    expect(text).not.toContain('"k"');
    expect(text).not.toContain('cid');
    expect(text).not.toContain('PLsecret');
    expect(text).not.toMatch(/accessToken|refreshToken/);
  });
});
