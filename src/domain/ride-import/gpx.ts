/**
 * GPX 1.1 -> RawRide: every track point's time, position and elevation, the Garmin
 * TrackPointExtension's heart rate and cadence, and power or speed from the extensions that carry
 * them (found by local name, whatever the prefix). GPX has no distance: it is added up from the
 * positions (haversine). Pauses show as gaps in time; the normalisation finds them.
 */

import type { RawRide, RawSample, RideImportWarning, RideReadResult, RideSport } from './types';
import { attr, child, children, deepNumber, numberOf, parseXml, textOf, timeOf } from './xml';

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in metres between two points in degrees. */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function sportOf(type: string | undefined): RideSport | undefined {
  const t = type?.toLowerCase();
  if (t === undefined) return undefined;
  if (/cycl|bik|ride/.test(t)) return 'cycling';
  if (/run/.test(t)) return 'running';
  return 'other';
}

export function readGpxRide(text: string): RideReadResult {
  const gpx = child(parseXml(text), 'gpx');
  if (!gpx) return { ok: false, error: { code: 'xmlInvalid' } };
  const tracks = children(gpx, 'trk');
  if (tracks.length === 0) {
    // Routes and waypoints are plans of a ride, not a ride.
    const plan = children(gpx, 'rte').length > 0 || children(gpx, 'wpt').length > 0;
    return { ok: false, error: { code: plan ? 'notARide' : 'noSamples' } };
  }

  const samples: RawSample[] = [];
  let untimed = 0;
  for (const trk of tracks) {
    for (const seg of children(trk, 'trkseg')) {
      for (const pt of children(seg, 'trkpt')) {
        const t = timeOf(textOf(child(pt, 'time')));
        if (t === undefined) {
          untimed += 1;
          continue;
        }
        const s: RawSample = { t };
        const lat = numberOf(attr(pt, 'lat'));
        const lon = numberOf(attr(pt, 'lon'));
        if (lat !== undefined && lon !== undefined) {
          s.lat = lat;
          s.lon = lon;
        }
        const ext = child(pt, 'extensions');
        const altitude = numberOf(textOf(child(pt, 'ele')));
        const heartRate = deepNumber(ext, ['hr', 'heartrate']);
        const cadence = deepNumber(ext, ['cad', 'cadence']);
        const power = deepNumber(ext, ['power', 'PowerInW', 'watts']);
        const speed = deepNumber(ext, ['speed']);
        if (altitude !== undefined) s.altitude = altitude;
        if (heartRate !== undefined) s.heartRate = heartRate;
        if (cadence !== undefined) s.cadence = cadence;
        if (power !== undefined) s.power = power;
        if (speed !== undefined) s.speed = speed;
        samples.push(s);
      }
    }
  }
  if (samples.length === 0) return { ok: false, error: { code: 'noSamples' } };
  samples.sort((a, b) => a.t - b.t);

  // Distance from the start, added up along the positions in time order.
  let total = 0;
  let prev: RawSample | undefined;
  for (const s of samples) {
    if (s.lat === undefined || s.lon === undefined) continue;
    if (prev?.lat !== undefined && prev.lon !== undefined) {
      total += haversineM(prev.lat, prev.lon, s.lat, s.lon);
    }
    s.distance = total;
    prev = s;
  }

  const first = tracks[0];
  const name = textOf(child(first, 'name')) ?? textOf(child(child(gpx, 'metadata'), 'name'));
  const sport = sportOf(textOf(child(first, 'type')));
  const ride: RawRide = {
    format: 'gpx',
    samples,
    timer: [],
    laps: [],
    meta: {
      ...(sport ? { sport } : {}),
      ...(name ? { name } : {}),
      startedAt:
        timeOf(textOf(child(child(gpx, 'metadata'), 'time'))) ?? (samples[0] as RawSample).t,
    },
    hints: {},
  };
  const warnings: RideImportWarning[] = [];
  if (untimed > 0) warnings.push('samplesWithoutTime');
  if (sport === 'running' || sport === 'other') warnings.push('notCycling');
  return { ok: true, ride, warnings };
}
