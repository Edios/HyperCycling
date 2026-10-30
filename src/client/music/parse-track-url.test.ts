import { describe, expect, it } from 'vitest';
import { parseClock, parseTrackUrl } from './parse-track-url';

describe('parseTrackUrl', () => {
  it.each([
    ['https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', 'spotify', '4uLU6hMCjMI75M1A2tKUQC'],
    [
      'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc123',
      'spotify',
      '4uLU6hMCjMI75M1A2tKUQC',
    ],
    [
      'https://open.spotify.com/intl-pl/track/4uLU6hMCjMI75M1A2tKUQC',
      'spotify',
      '4uLU6hMCjMI75M1A2tKUQC',
    ],
    ['spotify:track:4uLU6hMCjMI75M1A2tKUQC', 'spotify', '4uLU6hMCjMI75M1A2tKUQC'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=30', 'youtube', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=x', 'youtube', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['  https://music.youtube.com/watch?v=dQw4w9WgXcQ  ', 'youtube', 'dQw4w9WgXcQ'],
  ])('parses %s', (url, provider, id) => {
    expect(parseTrackUrl(url)).toEqual({ provider, id });
  });

  it.each([
    '',
    'not a url',
    'https://example.com/track/abc',
    'https://open.spotify.com/album/4uLU6hMCjMI75M1A2tKUQC',
    'https://www.youtube.com/watch',
    'https://www.youtube.com/watch?v=bad id',
    'spotify:track:',
  ])('rejects %j', (url) => {
    expect(parseTrackUrl(url)).toBeUndefined();
  });
});

describe('parseClock', () => {
  it('parses m:ss and plain seconds', () => {
    expect(parseClock('3:00')).toBe(180);
    expect(parseClock('0:45')).toBe(45);
    expect(parseClock('90')).toBe(90);
    expect(parseClock(' 12:05 ')).toBe(725);
  });
  it('rejects garbage and seconds >= 60 in m:ss', () => {
    expect(parseClock('')).toBeUndefined();
    expect(parseClock('1:75')).toBeUndefined();
    expect(parseClock('a:bc')).toBeUndefined();
    expect(parseClock('-5')).toBeUndefined();
  });
});
