import type { SurfaceType } from '$features/behavior-model/domain/entities/Surface';
import type { SurfaceBlueprint } from '../entities/SurfaceBlueprint';
import type { BlueprintCategory } from '../value-objects/BlueprintCategory';

export type BlueprintSort = 'name' | 'category';

export type BlueprintFilter = {
  readonly query: string;
  readonly category: BlueprintCategory | 'all';
  readonly surfaceType: SurfaceType | 'all';
  readonly sort: BlueprintSort;
};

export const emptyFilter: BlueprintFilter = {
  query: '',
  category: 'all',
  surfaceType: 'all',
  sort: 'name'
};

const matchesQuery = (bp: SurfaceBlueprint, q: string): boolean => {
  const haystack = [bp.name, bp.summary, bp.description, ...bp.tags]
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
};

export const filterBlueprints = (
  blueprints: readonly SurfaceBlueprint[],
  filter: BlueprintFilter
): readonly SurfaceBlueprint[] => {
  const q = filter.query.trim().toLowerCase();
  const filtered = blueprints.filter((bp) => {
    if (filter.category !== 'all' && bp.category !== filter.category) return false;
    if (filter.surfaceType !== 'all' && bp.surfaceType !== filter.surfaceType) return false;
    if (q.length > 0 && !matchesQuery(bp, q)) return false;
    return true;
  });
  const compareFn =
    filter.sort === 'name'
      ? (a: SurfaceBlueprint, b: SurfaceBlueprint) => a.name.localeCompare(b.name)
      : (a: SurfaceBlueprint, b: SurfaceBlueprint) =>
          a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
  return [...filtered].sort(compareFn);
};
