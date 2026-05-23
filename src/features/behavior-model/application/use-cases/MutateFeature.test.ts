import { describe, expect, it } from 'vitest';
import { fixedClock } from '$shared/domain/Clock';
import { InMemoryFeatureRepository } from '$features/behavior-model/infrastructure/persistence/InMemoryFeatureRepository';
import { storefrontFeature } from '$features/behavior-model/infrastructure/seed/seedStorefront';
import {
  asEffectId,
  asFeatureId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import {
  FeatureNotFoundError,
  FeatureValidationError,
  mutateFeatureUseCase
} from './MutateFeature';

const buildHarness = () => {
  const repository = new InMemoryFeatureRepository();
  const mutate = mutateFeatureUseCase({
    repository,
    clock: fixedClock('2026-05-09T00:00:00.000Z')
  });
  return { repository, mutate };
};

describe('mutateFeatureUseCase', () => {
  it('applies the transform, validates, and saves with a fresh updatedAt', async () => {
    const { repository, mutate } = buildHarness();
    await repository.save({ ...storefrontFeature, updatedAt: '2020-01-01T00:00:00.000Z' });
    const result = await mutate({
      featureId: storefrontFeature.id,
      transform: (current) => ({ ...current, name: 'Renamed' })
    });
    expect(result.name).toBe('Renamed');
    expect(result.updatedAt).toBe('2026-05-09T00:00:00.000Z');
    const persisted = await repository.get(storefrontFeature.id);
    expect(persisted?.name).toBe('Renamed');
  });

  it('throws FeatureNotFoundError when the id is unknown', async () => {
    const { mutate } = buildHarness();
    await expect(
      mutate({
        featureId: asFeatureId('does-not-exist'),
        transform: (e) => e
      })
    ).rejects.toBeInstanceOf(FeatureNotFoundError);
  });

  it('throws FeatureValidationError and never persists when transform breaks integrity', async () => {
    const { repository, mutate } = buildHarness();
    await repository.save(storefrontFeature);
    await expect(
      mutate({
        featureId: storefrontFeature.id,
        transform: (current) => ({
          ...current,
          surfaces: [...current.surfaces, { ...current.surfaces[0]! }]
        })
      })
    ).rejects.toBeInstanceOf(FeatureValidationError);
    const persisted = await repository.get(storefrontFeature.id);
    expect(persisted?.surfaces.length).toBe(storefrontFeature.surfaces.length);
  });

  it('rejects a mutation that introduces a new dangling transition_surface target', async () => {
    const { repository, mutate } = buildHarness();
    await repository.save(storefrontFeature);
    await expect(
      mutate({
        featureId: storefrontFeature.id,
        transform: (current) => ({
          ...current,
          surfaces: current.surfaces.map((s, i) =>
            i === 0
              ? {
                  ...s,
                  actions: s.actions.map((c, j) =>
                    j === 0
                      ? {
                          ...c,
                          effects: [
                            ...c.effects,
                            {
                              id: asEffectId('test-bad-target'),
                              type: 'transition_surface',
                              target: asSurfaceId('ghost-surface'),
                              description: 'Attempts to navigate to a missing surface.'
                            }
                          ]
                        }
                      : c
                  )
                }
              : s
          )
        })
      })
    ).rejects.toBeInstanceOf(FeatureValidationError);
  });

  it('allows mutations on a snapshot that already has a pre-existing dangling reference', async () => {
    const { repository, mutate } = buildHarness();
    // Seed an feature that already contains a dangling transition_surface
    // effect. A later unrelated mutation must still succeed (diff-aware
    // enforcement only blocks newly-introduced dangling refs).
    const seedWithDangler = {
      ...storefrontFeature,
      surfaces: storefrontFeature.surfaces.map((s, i) =>
        i === 0
          ? {
              ...s,
              actions: s.actions.map((c, j) =>
                j === 0
                  ? {
                      ...c,
                      effects: [
                        ...c.effects,
                        {
                          id: asEffectId('seed-pre-existing-dangler'),
                          type: 'transition_surface' as const,
                          target: asSurfaceId('was-deleted'),
                          description: 'Pre-existing transition to a deleted surface.'
                        }
                      ]
                    }
                  : c
              )
            }
          : s
      )
    };
    await repository.save(seedWithDangler);

    const result = await mutate({
      featureId: storefrontFeature.id,
      transform: (current) => ({ ...current, name: 'still mutable' })
    });
    expect(result.name).toBe('still mutable');
  });
});
