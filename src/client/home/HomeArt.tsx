import type { Mode } from '../brand';

/**
 * Decorative art of a mode tile. Plan: calm octagon rings; Freestyle: fast equalizer bars;
 * Experience: a neon horizon with a sun. Animated by the tile's hover/focus state (CSS, transform
 * and opacity only); static with reduced motion.
 */
export function HomeArt({ mode }: { mode: Exclude<Mode, 'coach'> }) {
  if (mode === 'plan') {
    return (
      <svg
        className="art"
        viewBox="0 0 200 200"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        aria-hidden="true"
        focusable="false"
      >
        {[
          [
            '183.1,134.4 134.4,183.1 65.6,183.1 16.9,134.4 16.9,65.6 65.6,16.9 134.4,16.9 183.1,65.6',
            0.89,
          ],
          [
            '166.5,127.6 127.6,166.5 72.4,166.5 33.5,127.6 33.5,72.4 72.4,33.5 127.6,33.5 166.5,72.4',
            0.76,
          ],
          [
            '149.9,120.7 120.7,149.9 79.3,149.9 50.1,120.7 50.1,79.3 79.3,50.1 120.7,50.1 149.9,79.3',
            0.64,
          ],
          [
            '133.3,113.8 113.8,133.3 86.2,133.3 66.7,113.8 66.7,86.2 86.2,66.7 113.8,66.7 133.3,86.2',
            0.51,
          ],
          [
            '116.6,106.9 106.9,116.6 93.1,116.6 83.4,106.9 83.4,93.1 93.1,83.4 106.9,83.4 116.6,93.1',
            0.38,
          ],
        ].map(([points, opacity], i) => (
          <polygon
            key={i}
            className="part"
            style={{ ['--i' as string]: i }}
            points={points as string}
            opacity={opacity as number}
          />
        ))}
      </svg>
    );
  }
  if (mode === 'free') {
    const bars: [number, number, number][] = [
      [150, 40, 0.5],
      [120, 70, 0.62],
      [135, 55, 0.56],
      [90, 100, 0.73],
      [50, 140, 0.89],
      [100, 90, 0.7],
      [30, 160, 0.97],
      [70, 120, 0.81],
      [130, 60, 0.58],
    ];
    return (
      <svg
        className="art"
        viewBox="0 0 200 200"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        {bars.map(([y, h, o], i) => (
          <rect
            key={i}
            className="part"
            style={{ ['--i' as string]: i }}
            x={8 + i * 21}
            y={y}
            width="14"
            height={h}
            rx="3"
            opacity={o}
          />
        ))}
      </svg>
    );
  }
  return (
    <svg
      className="art"
      viewBox="0 0 200 200"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        className="sun"
        cx="100"
        cy="70"
        r="34"
        fill="currentColor"
        opacity=".25"
        stroke="none"
      />
      <g className="floor">
        {[118, 140, 168, 200].map((y, i) => (
          <path key={y} d={`M0 ${y}H200`} opacity={0.4 + i * 0.15} />
        ))}
      </g>
      {[-60, -20, 20, 60, 100, 140, 180, 220, 260].map((x) => (
        <path key={x} d={`M${x} 200L100 100`} opacity=".5" />
      ))}
      <path d="M0 100H200" strokeWidth="3" />
    </svg>
  );
}
