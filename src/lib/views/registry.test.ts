import { describe, expect, it } from 'vitest';
import { isViewEnabled, parseEnabledViewIds, resolveEnabledViews } from './registry';

describe('view registry', () => {
  it('enables only Expert by default (unset / empty)', () => {
    for (const raw of [undefined, '', '   ', ',']) {
      expect(parseEnabledViewIds(raw)).toEqual(['expert']);
      expect(resolveEnabledViews(raw).map((v) => v.id)).toEqual(['expert']);
      expect(isViewEnabled(raw, 'builder')).toBe(false);
      expect(isViewEnabled(raw, 'expert')).toBe(true);
    }
  });

  it('enables Builder when requested', () => {
    expect(parseEnabledViewIds('builder')).toEqual(['expert', 'builder']);
    expect(isViewEnabled('builder', 'builder')).toBe(true);
    expect(resolveEnabledViews('builder').map((v) => v.id)).toEqual(['expert', 'builder']);
  });

  it('is tolerant: trims, lowercases, de-dupes, ignores unknown ids and explicit expert', () => {
    expect(parseEnabledViewIds(' Builder , builder, expert, nope ')).toEqual([
      'expert',
      'builder'
    ]);
  });

  it('Expert always lands first so it stays the default view', () => {
    expect(parseEnabledViewIds('builder')[0]).toBe('expert');
  });

  it('Builder view points at its route and matches that path', () => {
    const builder = resolveEnabledViews('builder').find((v) => v.id === 'builder')!;
    expect(builder.href).toBe('/builder-mode');
    expect(builder.matches('/builder-mode')).toBe(true);
    expect(builder.matches('/projects')).toBe(false);
  });

  it('Expert matches the root, projects, and features paths', () => {
    const expert = resolveEnabledViews(undefined)[0]!;
    expect(expert.matches('/')).toBe(true);
    expect(expert.matches('/projects/abc')).toBe(true);
    expect(expert.matches('/features/xyz')).toBe(true);
    expect(expert.matches('/builder-mode')).toBe(false);
  });
});
