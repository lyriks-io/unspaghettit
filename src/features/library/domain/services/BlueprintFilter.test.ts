import { describe, expect, it } from 'vitest';
import { asSurfaceId } from '$features/behavior-model/domain/value-objects/ids';
import type { SurfaceBlueprint } from '../entities/SurfaceBlueprint';
import { asBlueprintId } from '../value-objects/BlueprintId';
import { filterBlueprints, emptyFilter } from './BlueprintFilter';

const stub = (init: {
  id: string;
  name: string;
  category: SurfaceBlueprint['category'];
  tags?: readonly string[];
  surfaceType?: SurfaceBlueprint['surfaceType'];
}): SurfaceBlueprint => ({
  id: asBlueprintId(init.id),
  name: init.name,
  category: init.category,
  surfaceType: init.surfaceType ?? 'screen',
  summary: '',
  description: '',
  platforms: ['web'],
  tags: init.tags ?? [],
  build: () => ({
    surface: {
      id: asSurfaceId('s'),
      name: init.name,
      type: init.surfaceType ?? 'screen',
      stateDefinitions: [],
      actions: [],
      rules: [],
      invariants: [],
      transitions: []
    }
  })
});

const sample: readonly SurfaceBlueprint[] = [
  stub({ id: 'a', name: 'Sign in', category: 'auth', tags: ['login', 'authentication'] }),
  stub({ id: 'b', name: 'Sign up', category: 'auth', tags: ['register'] }),
  stub({ id: 'c', name: 'Cart', category: 'commerce' }),
  stub({ id: 'd', name: 'Settings', category: 'settings' })
];

describe('BlueprintFilter', () => {
  it('returns everything sorted by name with the empty filter', () => {
    const result = filterBlueprints(sample, emptyFilter);
    expect(result.map((b) => b.name)).toEqual(['Cart', 'Settings', 'Sign in', 'Sign up']);
  });

  it('filters by category', () => {
    const result = filterBlueprints(sample, { ...emptyFilter, category: 'auth' });
    expect(result).toHaveLength(2);
    expect(result.every((b) => b.category === 'auth')).toBe(true);
  });

  it('matches query against name, tags, and description', () => {
    const byName = filterBlueprints(sample, { ...emptyFilter, query: 'cart' });
    expect(byName.map((b) => b.name)).toEqual(['Cart']);

    const byTag = filterBlueprints(sample, { ...emptyFilter, query: 'login' });
    expect(byTag.map((b) => b.name)).toEqual(['Sign in']);
  });

  it('sorts by category groups when sort=category', () => {
    const result = filterBlueprints(sample, { ...emptyFilter, sort: 'category' });
    expect(result.map((b) => b.category)).toEqual(['auth', 'auth', 'commerce', 'settings']);
  });

  it('filters by surfaceType', () => {
    const mixed: readonly SurfaceBlueprint[] = [
      stub({ id: 'm1', name: 'Login modal', category: 'auth', surfaceType: 'dialog_area' }),
      stub({ id: 'm2', name: 'Search palette', category: 'utility', surfaceType: 'command_palette' }),
      stub({ id: 'm3', name: 'Catalog page', category: 'commerce', surfaceType: 'screen' })
    ];
    const screens = filterBlueprints(mixed, { ...emptyFilter, surfaceType: 'screen' });
    expect(screens.map((b) => b.name)).toEqual(['Catalog page']);
  });
});
