import { describe, expect, it, vi } from 'vitest';
import { createSound } from './sound';

interface FakeOsc {
  type: string;
  frequency: { value: number };
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

function fakeContext() {
  const oscs: FakeOsc[] = [];
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const ctx = {
    currentTime: 10,
    state: 'running',
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
    createOscillator: vi.fn(() => {
      const o: FakeOsc = {
        type: '',
        frequency: { value: 0 },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscs.push(o);
      return o;
    }),
    createGain: vi.fn(() => ({ gain: param(), connect: vi.fn() })),
  };
  return { ctx: ctx as unknown as AudioContext, oscs, raw: ctx };
}

describe('createSound', () => {
  it('tick is a 660 Hz sine of 120 ms', () => {
    const { ctx, oscs } = fakeContext();
    createSound(ctx).tick();
    expect(oscs).toHaveLength(1);
    expect(oscs[0]?.type).toBe('sine');
    expect(oscs[0]?.frequency.value).toBe(660);
    expect(oscs[0]?.start).toHaveBeenCalledWith(10);
    expect(oscs[0]?.stop).toHaveBeenCalledWith(10 + 0.12 + 0.02);
  });

  it('segment is 880 Hz for 250 ms', () => {
    const { ctx, oscs } = fakeContext();
    createSound(ctx).segment();
    expect(oscs[0]?.frequency.value).toBe(880);
    expect(oscs[0]?.stop).toHaveBeenCalledWith(10 + 0.25 + 0.02);
  });

  it('finish plays three rising tones', () => {
    const { ctx, oscs } = fakeContext();
    createSound(ctx).finish();
    const freqs = oscs.map((o) => o.frequency.value);
    expect(freqs).toHaveLength(3);
    expect(freqs[0]).toBeLessThan(freqs[1] ?? 0);
    expect(freqs[1]).toBeLessThan(freqs[2] ?? 0);
  });

  it('is silent when disabled', () => {
    const { ctx, oscs } = fakeContext();
    const s = createSound(ctx);
    s.setEnabled(false);
    s.tick();
    s.segment();
    s.finish();
    expect(oscs).toHaveLength(0);
    s.setEnabled(true);
    s.tick();
    expect(oscs).toHaveLength(1);
  });

  it('survives a missing AudioContext', () => {
    const s = createSound();
    expect(() => {
      s.unlock();
      s.tick();
    }).not.toThrow();
  });

  it('unlock resumes a suspended context', () => {
    const { ctx, raw } = fakeContext();
    raw.state = 'suspended';
    createSound(ctx).unlock();
    expect(raw.resume).toHaveBeenCalled();
  });
});
