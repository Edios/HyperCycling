import { describe, expect, it } from 'vitest';
import { gpx, points, START_MS, tcx } from './__fixtures__/xml-rides';
import { haversineM, readGpxRide } from './gpx';
import { readTcxRide } from './tcx';
import { deepNumber, parseXml } from './xml';

function ok(r: ReturnType<typeof readTcxRide>) {
  if (!r.ok) throw new Error(`expected a ride, got ${r.error.code}`);
  return r;
}

describe('readTcxRide', () => {
  it('reads every trackpoint with position, altitude, distance, HR, cadence, speed and watts', () => {
    const text = tcx(
      [
        [
          {
            sec: 0,
            lat: 52.1,
            lon: 21.2,
            ele: 110,
            dist: 0,
            hr: 120,
            cad: 85,
            power: 180,
            speed: 7.5,
          },
          { sec: 1, hr: 121 },
        ],
        [{ sec: 60, power: 250 }],
      ],
      { creator: 'Garmin Edge 530' },
    );
    const r = ok(readTcxRide(text));
    expect(r.warnings).toEqual([]);
    expect(r.ride.samples).toEqual([
      {
        t: START_MS,
        lat: 52.1,
        lon: 21.2,
        altitude: 110,
        distance: 0,
        heartRate: 120,
        cadence: 85,
        speed: 7.5,
        power: 180,
      },
      { t: START_MS + 1000, heartRate: 121 },
      { t: START_MS + 60_000, power: 250 },
    ]);
    expect(r.ride.laps).toEqual([
      { start: START_MS, end: START_MS + 1000 },
      { start: START_MS + 60_000, end: START_MS + 60_000 },
    ]);
    expect(r.ride.meta).toEqual({ sport: 'cycling', startedAt: START_MS, device: 'Garmin' });
    expect(r.ride.format).toBe('tcx');
  });

  it('reads the run cadence of a run, warns that it is not a ride, and orders the points', () => {
    const text = tcx([[{ sec: 5 }, { sec: 2 }]], { sport: 'Running', creator: 'Polar' }).replace(
      '<Trackpoint><Time>2026-11-22T08:00:02.000Z</Time>',
      '<Trackpoint><Time>2026-11-22T08:00:02.000Z</Time><Extensions><TPX><RunCadence>88</RunCadence></TPX></Extensions>',
    );
    const r = ok(readTcxRide(text));
    expect(r.warnings).toEqual(['notCycling']);
    expect(r.ride.samples).toEqual([{ t: START_MS + 2000, cadence: 88 }, { t: START_MS + 5000 }]);
    expect(r.ride.meta).toEqual({ sport: 'running', startedAt: START_MS });
    const other = ok(readTcxRide(tcx([[{ sec: 0 }]], { sport: 'Other' })));
    expect(other.ride.meta.sport).toBe('other');
  });

  it('leaves out points without a time, and a lap without a length', () => {
    const text = tcx([[{ sec: 0 }, { sec: 1 }]])
      .replace('<Time>2026-11-22T08:00:01.000Z</Time>', '<Time>not a time</Time>')
      .replace('<TotalTimeSeconds>1</TotalTimeSeconds>', '')
      .replace(/<Id>[^<]*<\/Id>/, '')
      .replace(' Sport="Biking"', '');
    const r = ok(readTcxRide(text));
    expect(r.warnings).toEqual(['samplesWithoutTime']);
    expect(r.ride.laps).toEqual([]);
    expect(r.ride.meta).toEqual({ startedAt: START_MS });
  });

  it('refuses broken XML, a DOCTYPE, other XML, a course and an empty activity', () => {
    expect(readTcxRide('<TrainingCenterDatabase><Activities>')).toEqual({
      ok: false,
      error: { code: 'xmlInvalid' },
    });
    const doctype = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><TrainingCenterDatabase/>`;
    expect(readTcxRide(doctype)).toEqual({ ok: false, error: { code: 'xmlInvalid' } });
    expect(readTcxRide('<gpx/>')).toEqual({ ok: false, error: { code: 'xmlInvalid' } });
    expect(
      readTcxRide('<TrainingCenterDatabase><Courses><Course/></Courses></TrainingCenterDatabase>'),
    ).toEqual({ ok: false, error: { code: 'notARide' } });
    expect(readTcxRide('<TrainingCenterDatabase><Activities/></TrainingCenterDatabase>')).toEqual({
      ok: false,
      error: { code: 'noSamples' },
    });
    expect(readTcxRide(tcx([[]]))).toEqual({ ok: false, error: { code: 'noSamples' } });
  });
});

describe('readGpxRide', () => {
  it('reads time, position, elevation and the extensions, and adds up the distance', () => {
    const text = gpx(
      [
        points(3, (i) => ({ lat: 50 + i * 0.001, lon: 20, ele: 200 + i, hr: 140 + i, cad: 80 })),
        [{ sec: 10, lat: 50.003, lon: 20, power: 300 }],
      ],
      { name: 'Morning Ride', type: 'cycling' },
    );
    const r = ok(readGpxRide(text));
    expect(r.warnings).toEqual([]);
    const [a, b, , d] = r.ride.samples;
    expect(a).toEqual({
      t: START_MS,
      lat: 50,
      lon: 20,
      altitude: 200,
      heartRate: 140,
      cadence: 80,
      distance: 0,
    });
    // 0.001 degree of latitude is about 111 m
    expect(b?.distance).toBeCloseTo(111.2, 0);
    expect(d).toMatchObject({ t: START_MS + 10_000, power: 300 });
    expect(d?.distance).toBeCloseTo(333.6, 0);
    expect(r.ride.meta).toEqual({ sport: 'cycling', name: 'Morning Ride', startedAt: START_MS });
    expect(r.ride.format).toBe('gpx');
  });

  it('finds power and speed under other names, without a namespace prefix', () => {
    const text = gpx([[{ sec: 0 }]]).replace(
      '<trkpt lat="0" lon="0">',
      '<trkpt lat="0" lon="0"><extensions><pwr:PowerInW xmlns:pwr="x">275</pwr:PowerInW><speed>9.1</speed></extensions>',
    );
    expect(ok(readGpxRide(text)).ride.samples[0]).toMatchObject({ power: 275, speed: 9.1 });
  });

  it('knows a run and other sports by the track type, and works without positions', () => {
    const run = ok(readGpxRide(gpx([[{ sec: 0 }]], { type: 'running' })));
    expect(run.warnings).toEqual(['notCycling']);
    expect(ok(readGpxRide(gpx([[{ sec: 0 }]], { type: 'Ride' }))).ride.meta.sport).toBe('cycling');
    expect(ok(readGpxRide(gpx([[{ sec: 0 }]], { type: 'hike' }))).ride.meta.sport).toBe('other');
    const noPos = gpx([[{ sec: 0 }, { sec: 1 }]])
      .replaceAll(' lat="0" lon="0"', '')
      .replace(/<metadata>.*<\/metadata>/, '');
    const r = ok(readGpxRide(noPos));
    expect(r.ride.samples).toEqual([{ t: START_MS }, { t: START_MS + 1000 }]);
    expect(r.ride.meta).toEqual({ startedAt: START_MS });
  });

  it('leaves out points without a time; refuses routes, empty tracks and other XML', () => {
    const text = gpx([[{ sec: 0 }, { sec: 1 }]]).replace(
      '<time>2026-11-22T08:00:01.000Z</time>',
      '',
    );
    expect(ok(readGpxRide(text)).warnings).toEqual(['samplesWithoutTime']);
    expect(readGpxRide('<gpx><rte><rtept lat="1" lon="2"/></rte></gpx>')).toEqual({
      ok: false,
      error: { code: 'notARide' },
    });
    expect(readGpxRide('<gpx><metadata/></gpx>')).toEqual({
      ok: false,
      error: { code: 'noSamples' },
    });
    expect(readGpxRide(gpx([[]]))).toEqual({ ok: false, error: { code: 'noSamples' } });
    expect(readGpxRide('<TrainingCenterDatabase/>')).toEqual({
      ok: false,
      error: { code: 'xmlInvalid' },
    });
  });

  it('measures distance on the sphere', () => {
    expect(haversineM(0, 0, 0, 1)).toBeCloseTo(111_195, -1);
    expect(haversineM(52, 21, 52, 21)).toBe(0);
  });
});

describe('xml helpers', () => {
  it('skips a non-number and keeps looking deeper', () => {
    const doc = parseXml('<a><hr>n/a</hr><b><hr>131</hr></b></a>');
    expect(deepNumber(doc, ['hr'])).toBe(131);
    expect(deepNumber(undefined, ['hr'])).toBeUndefined();
    expect(parseXml('\uFEFF<a/>')).toBeDefined();
  });
});
