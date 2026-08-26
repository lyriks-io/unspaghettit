import { describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { FeatureRepository } from '$features/behavior-model/application/ports/FeatureRepository';
import { asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
import { InMemoryFeatureRepository } from '$features/behavior-model/infrastructure/persistence/InMemoryFeatureRepository';
import { listAllFeatures, loadFeaturesByIds } from './bulkRead';

const feature = (id: string): Feature => ({
  id: asFeatureId(id),
  name: id,
  surfaces: [],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z'
});

/** A port implementation without `listFull`, counting every `get`. */
const withoutBulk = (inner: FeatureRepository): FeatureRepository & { gets: number } => {
  const wrapped = {
    gets: 0,
    list: () => inner.list(),
    get: (id: Parameters<FeatureRepository['get']>[0]) => {
      wrapped.gets += 1;
      return inner.get(id);
    },
    save: (f: Feature) => inner.save(f),
    delete: (id: Parameters<FeatureRepository['delete']>[0]) => inner.delete(id)
  };
  return wrapped;
};

describe('bulkRead', () => {
  it('reads many ids in one pass when the store offers listFull, keeping order and nulls', async () => {
    const repo = new InMemoryFeatureRepository();
    await repo.save(feature('a'));
    await repo.save(feature('b'));

    const loaded = await loadFeaturesByIds(repo, ['b', 'missing', 'a']);
    expect(loaded.map((f) => f?.id ?? null)).toEqual(['b', null, 'a']);
    expect((await listAllFeatures(repo)).map((f) => f.id).sort()).toEqual(['a', 'b']);
  });

  it('falls back to list + get for a store without listFull', async () => {
    const inner = new InMemoryFeatureRepository();
    await inner.save(feature('a'));
    await inner.save(feature('b'));
    const repo = withoutBulk(inner);

    expect((await listAllFeatures(repo)).map((f) => f.id).sort()).toEqual(['a', 'b']);
    expect(repo.gets).toBe(2);
    const loaded = await loadFeaturesByIds(repo, ['a', 'nope']);
    expect(loaded.map((f) => f?.id ?? null)).toEqual(['a', null]);
    expect(repo.gets).toBe(4);
  });

  it('uses a plain get for a single id even when listFull exists', async () => {
    const repo = new InMemoryFeatureRepository();
    await repo.save(feature('a'));
    let bulk = 0;
    const spied: FeatureRepository = {
      list: () => repo.list(),
      get: (id) => repo.get(id),
      save: (f) => repo.save(f),
      delete: (id) => repo.delete(id),
      listFull: () => {
        bulk += 1;
        return repo.listFull();
      }
    };
    expect((await loadFeaturesByIds(spied, ['a']))[0]?.id).toBe('a');
    expect(bulk).toBe(0);
  });
});
