import { describe, expect, it } from 'vitest';
import { fixedClock } from '$shared/domain/Clock';
import { InMemoryFeatureRepository } from '$features/behavior-model/infrastructure/persistence/InMemoryFeatureRepository';
import { createFeatureUseCase } from './CreateFeature';

describe('createFeatureUseCase', () => {
  it('persists the feature with provided name and clock', async () => {
    const repository = new InMemoryFeatureRepository();
    let counter = 0;
    const create = createFeatureUseCase({
      repository,
      ids: () => `id-${++counter}`,
      clock: fixedClock('2026-05-08T12:00:00.000Z')
    });
    const feature = await create({ name: 'Booking', description: 'Restaurant booking' });
    expect(feature.id).toBe('id-1');
    expect(feature.name).toBe('Booking');
    expect(feature.createdAt).toBe('2026-05-08T12:00:00.000Z');
    expect(await repository.get(feature.id)).not.toBeNull();
  });

  it('rejects empty names', async () => {
    const repository = new InMemoryFeatureRepository();
    const create = createFeatureUseCase({
      repository,
      ids: () => 'id',
      clock: fixedClock('2026-05-08T12:00:00.000Z')
    });
    await expect(create({ name: '   ' })).rejects.toThrow(/required/);
  });
});
