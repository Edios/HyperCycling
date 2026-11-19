import { describe, expect, it } from 'vitest';
import type { Experience } from '../../domain/experience';
import { builtinExperiences } from '../data/builtin';
import { defaultVariant, groupSeries, variantLabel } from './model';

const fake = (
  id: string,
  theme: 'abstract' | 'neon-grid',
  lengthMin: 30 | 45 | 60,
  level: 'easy' | 'medium' | 'hard',
) => ({ id, worldTheme: { theme }, lengthMin, level }) as unknown as Experience;

describe('groupSeries', () => {
  it('puts the three Neon Grid rides into one series, shortest first, easier before harder', () => {
    const groups = groupSeries(builtinExperiences);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.theme).toBe('neon-grid');
    expect(groups[0]!.variants.map((e) => e.id)).toEqual([
      'neon-grid-30',
      'neon-grid-45-light',
      'neon-grid-45',
    ]);
  });

  it('keeps abstract rides as cards of their own and the order of first appearance', () => {
    const list = [
      fake('a', 'abstract', 30, 'easy'),
      fake('n1', 'neon-grid', 45, 'hard'),
      fake('b', 'abstract', 60, 'hard'),
      fake('n2', 'neon-grid', 30, 'medium'),
    ];
    const groups = groupSeries(list);
    expect(groups.map((g) => g.key)).toEqual(['a', 'neon-grid', 'b']);
    expect(groups[1]!.variants.map((e) => e.id)).toEqual(['n2', 'n1']);
  });
});

describe('variantLabel', () => {
  it('strips the series name and gives a bare length its unit', () => {
    expect(variantLabel('Neon Grid 30', 'Neon Grid')).toBe('30 min');
    expect(variantLabel('Neon Grid Light 45', 'Neon Grid')).toBe('Light 45');
    expect(variantLabel('Neon Grid 45', 'Neon Grid', 'min')).toBe('45 min');
    expect(variantLabel('Neon Grid 45', 'Neon Grid', 'min.')).toBe('45 min.');
  });

  it('keeps a title that does not start with the series name, or is the name itself', () => {
    expect(variantLabel('Sunrise', 'Neon Grid')).toBe('Sunrise');
    expect(variantLabel('Neon Grid', 'Neon Grid')).toBe('Neon Grid');
  });
});

describe('defaultVariant', () => {
  const series = groupSeries(builtinExperiences)[0]!;
  it('opens on the first variant that fits the level filter, else on the first', () => {
    expect(defaultVariant(series, 'all').id).toBe('neon-grid-30');
    expect(defaultVariant(series, 'hard').id).toBe('neon-grid-45');
    expect(defaultVariant(series, 'medium').id).toBe('neon-grid-30');
    expect(defaultVariant(series, 'easy').id).toBe('neon-grid-30');
  });
});
