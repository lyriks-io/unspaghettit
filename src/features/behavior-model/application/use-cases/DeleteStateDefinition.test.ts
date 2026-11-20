import { it, expect } from 'vitest';
import { DeleteStateDefinitionUseCase } from './DeleteStateDefinition';
import { InMemoryFeatureRepository } from '../../infrastructure/persistence/InMemoryFeatureRepository';
import { storefrontFeature } from '../../infrastructure/seed/seedStorefront';
import { fixedClock } from '$shared/domain/Clock';
import { asInvariantId, asStateDefinitionId } from '../../domain/value-objects/ids';
import { InMemoryProjectRepository } from '$features/projects/infrastructure/persistence/InMemoryProjectRepository';
import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import { projectInvariantGuard } from '$features/projects/application/services/projectInvariantGuard';
import { asStatePath } from '../../domain/value-objects/StatePath';

it('keeps local reference validation in standalone/Community and deletes an unused state', async () => {
  const repository = new InMemoryFeatureRepository();
  const surface = storefrontFeature.surfaces.find((s) =>
    s.stateDefinitions.some((d) => d.path === 'cart.itemCount')
  )!;
  const used = {
    id: asStateDefinitionId('required'),
    path: asStatePath('test.required'),
    type: 'number' as const,
    defaultValue: 0,
    description: 'Required test state'
  };
  const baseline = {
    ...storefrontFeature,
    surfaces: storefrontFeature.surfaces.map((s) =>
      s.id === surface.id
        ? {
            ...s,
            stateDefinitions: [...s.stateDefinitions, used],
            actions: s.actions.map((a, i) =>
              i === 0 ? { ...a, requiredStates: [...(a.requiredStates ?? []), used.path] } : a
            )
          }
        : s
    )
  };
  await repository.save(baseline);
  const command = new DeleteStateDefinitionUseCase(
    repository,
    fixedClock('2026-09-07T12:00:00.000Z')
  );
  const input = {
    projectId: null,
    featureId: storefrontFeature.id,
    surfaceId: surface.id,
    stateDefinitionId: used.id
  };
  expect(await command.execute(input)).toMatchObject({ ok: false, formalChecked: false });
  expect(await repository.get(storefrontFeature.id)).toEqual(baseline);
  const unused = {
    id: asStateDefinitionId('unused'),
    path: asStatePath('test.unused'),
    type: 'number' as const,
    defaultValue: 0,
    description: 'Unused test state'
  };
  await repository.save({
    ...storefrontFeature,
    surfaces: storefrontFeature.surfaces.map((s) =>
      s.id === surface.id ? { ...s, stateDefinitions: [...s.stateDefinitions, unused] } : s
    )
  });
  expect(await command.execute({ ...input, stateDefinitionId: unused.id })).toMatchObject({
    ok: true,
    formalChecked: false
  });
  expect(
    (await repository.get(storefrontFeature.id))?.surfaces
      .find((s) => s.id === surface.id)
      ?.stateDefinitions.some((s) => s.id === unused.id)
  ).toBe(false);
});

it('refuses the deletion when it would leave a project invariant reading a state no feature declares', async () => {
  const repository = new InMemoryFeatureRepository();
  const surface = storefrontFeature.surfaces[0]!;
  const age = {
    id: asStateDefinitionId('age'),
    path: asStatePath('profile.age'),
    type: 'number' as const,
    defaultValue: 20,
    description: 'The age of the shopper.'
  };
  const baseline = {
    ...storefrontFeature,
    surfaces: storefrontFeature.surfaces.map((s) =>
      s.id === surface.id ? { ...s, stateDefinitions: [...s.stateDefinitions, age] } : s
    )
  };
  await repository.save(baseline);
  const projects = new InMemoryProjectRepository();
  await projects.save({
    id: 'proj-shop' as ProjectId,
    name: 'Shop',
    description: 'The shop.',
    featureIds: [storefrontFeature.id],
    createdAt: '2026-09-07T12:00:00.000Z',
    updatedAt: '2026-09-07T12:00:00.000Z',
    projectInvariants: [
      {
        id: asInvariantId('pinv-adult'),
        name: 'Adult shoppers',
        condition: { left: age.path, operator: 'greater_or_equal', right: 18 },
        message: 'Shoppers are adults.',
        description: 'Every shopper is an adult.'
      }
    ]
  });
  const command = new DeleteStateDefinitionUseCase(
    repository,
    fixedClock('2026-09-07T12:00:00.000Z'),
    projectInvariantGuard(repository, projects)
  );
  const result = await command.execute({
    projectId: null,
    featureId: storefrontFeature.id,
    surfaceId: surface.id,
    stateDefinitionId: age.id
  });
  expect(result).toMatchObject({ ok: false });
  expect(result.message).toContain('Adult shoppers');
  expect(await repository.get(storefrontFeature.id)).toEqual(baseline);
});
