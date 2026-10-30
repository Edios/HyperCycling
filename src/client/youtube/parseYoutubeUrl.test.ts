import { describe, expect, it } from 'vitest';
import { parseStartTime, parseYoutubeUrl } from './parseYoutubeUrl';

const ID = 'dQw4w9WgXcQ';

describe('parseYoutubeUrl', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`, 0],
    [`https://youtube.com/watch?v=${ID}&feature=share`, 0],
    [`http://www.youtube.com/watch?v=${ID}`, 0],
    [`https://m.youtube.com/watch?v=${ID}`, 0],
    [`https://music.youtube.com/watch?v=${ID}&list=abc`, 0],
    [`https://youtu.be/${ID}`, 0],
    [`https://youtu.be/${ID}?si=xyz`, 0],
    [`https://www.youtube.com/shorts/${ID}`, 0],
    [`https://www.youtube.com/embed/${ID}`, 0],
    [`https://www.youtube.com/live/${ID}`, 0],
    [`youtube.com/watch?v=${ID}`, 0],
    [`  https://youtu.be/${ID}  `, 0],
    [`https://www.youtube.com/watch?v=${ID}&t=90`, 90],
    [`https://www.youtube.com/watch?v=${ID}&t=90s`, 90],
    [`https://youtu.be/${ID}?t=1m30s`, 90],
    [`https://youtu.be/${ID}?t=1h2m3s`, 3723],
    [`https://www.youtube.com/embed/${ID}?start=45`, 45],
    [`https://www.youtube.com/watch?v=${ID}&t=garbage`, 0],
  ])('%s', (url, startSec) => {
    expect(parseYoutubeUrl(url)).toEqual({ videoId: ID, startSec });
  });

  it.each([
    '',
    '   ',
    'not a url',
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ_toolong',
    'https://www.youtube.com/playlist?list=PL123',
    'https://www.youtube.com/',
    'https://youtu.be/',
    'https://youtu.be/bad id',
    'ftp://youtu.be/dQw4w9WgXcQ',
    'javascript:alert(1)',
  ])('rejects %j', (url) => {
    expect(parseYoutubeUrl(url)).toBeNull();
  });
});

describe('parseStartTime', () => {
  it.each([
    ['0', 0],
    ['125', 125],
    ['30s', 30],
    ['2m', 120],
    ['1h', 3600],
    ['1H2M3S', 3723],
  ])('%s', (raw, sec) => expect(parseStartTime(raw)).toBe(sec));

  it.each(['', 'abc', '-5', '1.5', '1x'])('rejects %j', (raw) => {
    expect(parseStartTime(raw)).toBeUndefined();
  });
});
