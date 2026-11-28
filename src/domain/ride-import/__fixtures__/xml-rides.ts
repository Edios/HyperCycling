/** Test-only builders of TCX and GPX text, one point per entry. */

export interface Point {
  /** Seconds from the start. */
  sec: number;
  lat?: number;
  lon?: number;
  ele?: number;
  dist?: number;
  hr?: number;
  cad?: number;
  power?: number;
  speed?: number;
}

export const START_ISO = '2026-11-22T08:00:00Z';
export const START_MS = Date.parse(START_ISO);
const iso = (sec: number) => new Date(START_MS + sec * 1000).toISOString();

const tag = (name: string, v: number | undefined) =>
  v === undefined ? '' : `<${name}>${v}</${name}>`;

function trackpoint(p: Point): string {
  const pos =
    p.lat !== undefined && p.lon !== undefined
      ? `<Position><LatitudeDegrees>${p.lat}</LatitudeDegrees><LongitudeDegrees>${p.lon}</LongitudeDegrees></Position>`
      : '';
  const hr = p.hr === undefined ? '' : `<HeartRateBpm><Value>${p.hr}</Value></HeartRateBpm>`;
  const ext =
    p.power !== undefined || p.speed !== undefined
      ? `<Extensions><ns3:TPX>${tag('ns3:Speed', p.speed)}${tag('ns3:Watts', p.power)}</ns3:TPX></Extensions>`
      : '';
  return `<Trackpoint><Time>${iso(p.sec)}</Time>${pos}${tag('AltitudeMeters', p.ele)}${tag('DistanceMeters', p.dist)}${hr}${tag('Cadence', p.cad)}${ext}</Trackpoint>`;
}

/** A TCX activity; each inner list is one lap (one track each). */
export function tcx(laps: Point[][], opts: { sport?: string; creator?: string } = {}): string {
  const body = laps
    .map((pts) => {
      const first = pts[0]?.sec ?? 0;
      const last = pts[pts.length - 1]?.sec ?? 0;
      return `<Lap StartTime="${iso(first)}"><TotalTimeSeconds>${last - first}</TotalTimeSeconds><Track>${pts.map(trackpoint).join('')}</Track></Lap>`;
    })
    .join('');
  const creator = opts.creator ? `<Creator><Name>${opts.creator}</Name></Creator>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
<Activities><Activity Sport="${opts.sport ?? 'Biking'}"><Id>${iso(0)}</Id>${body}${creator}</Activity></Activities>
</TrainingCenterDatabase>`;
}

function trkpt(p: Point): string {
  const ext =
    p.hr !== undefined || p.cad !== undefined || p.power !== undefined
      ? `<extensions>${tag('power', p.power)}<gpxtpx:TrackPointExtension>${tag('gpxtpx:hr', p.hr)}${tag('gpxtpx:cad', p.cad)}</gpxtpx:TrackPointExtension></extensions>`
      : '';
  return `<trkpt lat="${p.lat ?? 0}" lon="${p.lon ?? 0}">${tag('ele', p.ele)}<time>${iso(p.sec)}</time>${ext}</trkpt>`;
}

/** A GPX track; each inner list is one segment. */
export function gpx(segments: Point[][], opts: { name?: string; type?: string } = {}): string {
  const segs = segments.map((pts) => `<trkseg>${pts.map(trkpt).join('')}</trkseg>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="StravaGPX" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
<metadata><time>${iso(0)}</time></metadata>
<trk>${opts.name ? `<name>${opts.name}</name>` : ''}${opts.type ? `<type>${opts.type}</type>` : ''}${segs}</trk>
</gpx>`;
}

/** `n` points, one a second from `from`, made by `f`. */
export function points(n: number, f: (i: number) => Omit<Point, 'sec'>, from = 0): Point[] {
  return Array.from({ length: n }, (_, i) => ({ sec: from + i, ...f(i) }));
}
