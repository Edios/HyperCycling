import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashLine, EffortRing, LogoMark, Wordmark, ZONE_COLORS, ringSegments } from '.';

describe('ringSegments', () => {
  it('makes 10 segments filled up to the effort', () => {
    const segs = ringSegments({ effort: 7 });
    expect(segs).toHaveLength(10);
    expect(segs.filter((s) => s.filled)).toHaveLength(7);
    expect(segs[0]?.color).toBe(ZONE_COLORS[0]);
    expect(segs[7]?.color).toBeUndefined();
  });
  it('draws unfilled segments solid when asked', () => {
    expect(ringSegments({ effort: 0, solidOff: true })[3]?.color).toBe('#28313d');
  });
  it('leaves the bottom quarter open (270 degrees)', () => {
    // The first segment starts at 135 deg (bottom left), the last ends at 45 deg (bottom right).
    const first = ringSegments({ effort: 10 })[0]?.d ?? '';
    const x = Number(first.slice(1).split(' ')[0]);
    const y = Number(first.slice(1).split(' ')[1]);
    expect(x).toBeLessThan(50);
    expect(y).toBeGreaterThan(50);
  });
});

describe('ZONE_COLORS', () => {
  it('matches the zone palette', () => {
    expect([...ZONE_COLORS]).toEqual([
      '#8fdcff',
      '#8fdcff',
      '#2f6bff',
      '#2f6bff',
      '#35d07f',
      '#35d07f',
      '#ffd23f',
      '#ff8c2a',
      '#ff4d4d',
      '#ff4d4d',
    ]);
  });
});

describe('LogoMark', () => {
  it('draws 10 coloured ticks and no digit', () => {
    const { container } = render(<LogoMark />);
    const paths = container.querySelectorAll('path');
    expect(paths).toHaveLength(10);
    expect(paths[9]?.getAttribute('fill')).toBe('#ff4d4d');
    expect(container.querySelector('text')).toBeNull();
    expect(container.textContent).toBe('');
  });
  it('is decorative unless it has a title', () => {
    const { rerender } = render(<LogoMark />);
    expect(screen.getByTestId('logo-mark')).toHaveAttribute('aria-hidden', 'true');
    rerender(<LogoMark title="HyperCycling" />);
    expect(screen.getByRole('img', { name: 'HyperCycling' })).toBeInTheDocument();
  });
  it('mono uses currentColor and size sets the box', () => {
    const { container } = render(<LogoMark mono size={64} />);
    expect(container.querySelector('path')).toHaveAttribute('fill', 'currentColor');
    expect(screen.getByTestId('logo-mark')).toHaveAttribute('width', '64');
  });
});

describe('Wordmark', () => {
  it('reads HyperCycling', () => {
    const { container } = render(<Wordmark />);
    expect(container.textContent).toBe('HyperCycling');
  });
});

describe('DashLine', () => {
  it('is decorative', () => {
    render(<DashLine />);
    expect(screen.getByTestId('dash-line')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('EffortRing', () => {
  it('fills segments up to the effort in zone colours and outlines the rest', () => {
    const { container } = render(<EffortRing effort={7} />);
    const paths = [...container.querySelectorAll('path')];
    expect(paths).toHaveLength(10);
    expect(paths[0]).toHaveAttribute('fill', '#8fdcff');
    expect(paths[6]).toHaveAttribute('fill', '#ffd23f');
    expect(paths[7]).toHaveAttribute('fill', 'none');
    expect(paths[7]).toHaveAttribute('stroke', '#28313d');
    expect(screen.getByText('07')).toBeInTheDocument();
  });
  it('clamps and rounds the effort', () => {
    const { rerender } = render(<EffortRing effort={42} />);
    expect(screen.getByText('10')).toBeInTheDocument();
    rerender(<EffortRing effort={-3} />);
    expect(screen.getByText('00')).toBeInTheDocument();
    rerender(<EffortRing effort={Number.NaN} />);
    expect(screen.getByTestId('effort-ring')).toHaveAttribute('data-effort', '0');
  });
  it('quiet halves the opacity and greys the number', () => {
    const { container } = render(<EffortRing effort={9} quiet />);
    expect(container.querySelector('path')).toHaveAttribute('opacity', '0.5');
    expect(screen.getByText('09')).toHaveStyle({ color: '#b4bcc9' });
    expect(screen.getByTestId('effort-ring')).toHaveAttribute('data-quiet', 'true');
  });
  it('exposes a label as an image role', () => {
    render(<EffortRing effort={5} label="Effort 5 of 10" />);
    expect(screen.getByRole('img', { name: 'Effort 5 of 10' })).toBeInTheDocument();
  });
  it('sizes the box', () => {
    render(<EffortRing effort={5} size={120} />);
    expect(screen.getByTestId('effort-ring')).toHaveStyle({ width: '120px', height: '120px' });
  });
  it('takes a CSS length as the size and a number colour', () => {
    render(<EffortRing effort={5} size="clamp(100px, 20vh, 300px)" numColor="var(--zone)" />);
    expect(screen.getByTestId('effort-ring')).toHaveStyle({ width: 'clamp(100px, 20vh, 300px)' });
    expect(screen.getByText('05')).toHaveStyle({ color: 'var(--zone)' });
  });
  it('scales the number with --num-k (default 0.4)', () => {
    render(<EffortRing effort={5} size="var(--ring)" numberTestId="n" />);
    expect((screen.getByTestId('n') as HTMLElement).style.fontSize).toContain('var(--num-k, 0.4)');
  });
  it('puts the number test id on the number', () => {
    render(<EffortRing effort={5} numberTestId="n" />);
    expect(screen.getByTestId('n')).toHaveTextContent('05');
  });

  describe('motion', () => {
    const animate = vi.fn();
    afterEach(() => {
      animate.mockReset();
      // @ts-expect-error cleaning the test stub off the prototype
      delete Element.prototype.animate;
    });
    function stub(): void {
      Element.prototype.animate = animate;
    }

    it('fills the new segments one after the other, low to high, and rolls the number', () => {
      stub();
      const { rerender } = render(<EffortRing effort={7} motion />);
      expect(animate).not.toHaveBeenCalled(); // first render never animates
      rerender(<EffortRing effort={9} motion />);
      const delays = animate.mock.calls.map((c) => (c[1] as { delay?: number }).delay);
      // segments 8 and 9 (35 ms apart), then the number
      expect(delays.slice(0, 2)).toEqual([0, 35]);
      expect(animate).toHaveBeenCalledTimes(3);
    });

    it('empties from the highest segment when the effort drops', () => {
      stub();
      const { rerender, container } = render(<EffortRing effort={9} motion />);
      rerender(<EffortRing effort={7} motion />);
      expect(animate).toHaveBeenCalledTimes(3);
      expect(container.querySelectorAll('path')).toHaveLength(10);
    });

    it('does nothing without motion', () => {
      stub();
      const { rerender } = render(<EffortRing effort={3} />);
      rerender(<EffortRing effort={8} />);
      expect(animate).not.toHaveBeenCalled();
    });
  });
});
