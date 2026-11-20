import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fixedClock } from '../../src/shared/domain/Clock';
import { InMemoryFeatureRepository } from '../../src/features/behavior-model/infrastructure/persistence/InMemoryFeatureRepository';
import { InMemoryProjectRepository } from '../../src/features/projects/infrastructure/persistence/InMemoryProjectRepository';
import type { Project } from '../../src/features/projects/domain/entities/Project';
import type { ProjectId } from '../../src/features/projects/domain/value-objects/ids';
import {
  asFeatureId,
  asInvariantId,
  asStateDefinitionId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '../../src/features/behavior-model/domain/value-objects/StatePath';
import {
  VALIDATION,
  validationFeature
} from '../../src/features/behavior-model/domain/services/DisabledElements.fixture';
import { buildServer } from '../server';

/**
 * A project invariant reads state its features declare. A change to one
 * feature that takes away the last declaration of such a path (a rename, a
 * removal, the surface that held it) is refused, naming the invariant: the
 * project batch refuses to write an invariant over a path no feature declares,
 * and a feature write must not reach the same state by the back door.
 */

const NOW = '2026-11-18T10:00:00.000Z';
const rawText = (r: unknown): string =>
  (r as { content: { text: string }[] }).content[0]!.text;
const errored = (r: unknown): boolean => (r as { isError?: boolean }).isError === true;

const setup = async () => {
  const repo = new InMemoryFeatureRepository();
  const feature = validationFeature();
  await repo.save({
    ...feature,
    surfaces: feature.surfaces.map((s) => ({
      ...s,
      stateDefinitions: [
        ...s.stateDefinitions,
        {
          id: asStateDefinitionId('sd-age'),
          path: asStatePath('profile.age'),
          type: 'number',
          defaultValue: 20,
          description: 'The age of the person signed in.'
        }
      ]
    }))
  });
  const projectRepo = new InMemoryProjectRepository();
  const project: Project = {
    id: 'proj-adults' as ProjectId,
    name: 'Adults',
    description: 'Only adults validate.',
    featureIds: [asFeatureId(VALIDATION.feature)],
    createdAt: NOW,
    updatedAt: NOW,
    projectInvariants: [
      {
        id: asInvariantId('pinv-adults'),
        name: 'Only adults',
        condition: { left: asStatePath('profile.age'), operator: 'greater_or_equal', right: 18 },
        message: 'The person signed in is an adult.',
        description: 'Every person signed in is an adult.'
      }
    ]
  };
  await projectRepo.save(project);
  let n = 0;
  const server = buildServer(repo, { ids: () => `id-${n++}`, clock: fixedClock(NOW), projectRepo });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
  const paths = async () =>
    (await repo.get(asFeatureId(VALIDATION.feature)))!.surfaces.flatMap((s) =>
      s.stateDefinitions.map((d) => String(d.path))
    );
  return { server, call, paths };
};

describe('a feature write that takes away a path a project invariant reads', () => {
  it('refuses an apply_batch rename, naming the invariant, and saves nothing', async () => {
    const { server, call, paths } = await setup();
    const answer = await call('apply_batch', {
      featureId: VALIDATION.feature,
      operations: [
        { kind: 'update_state_definition', surfaceId: VALIDATION.surface, stateDefinitionId: 'sd-age', path: 'profile.years' }
      ]
    });
    const body = JSON.parse(rawText(answer)) as { ok: boolean; validation?: { errors?: string[] } };
    expect(body.ok).toBe(false);
    expect(body.validation?.errors?.join('\n')).toContain('"profile.age"');
    expect(body.validation?.errors?.join('\n')).toContain('Only adults');
    expect(await paths()).toContain('profile.age');
    await server.close();
  });

  it('answers the same refusal on a dry run', async () => {
    const { server, call } = await setup();
    const answer = await call('apply_batch', {
      featureId: VALIDATION.feature,
      dryRun: true,
      operations: [{ kind: 'remove_state_definition', surfaceId: VALIDATION.surface, stateDefinitionId: 'sd-age' }]
    });
    const body = JSON.parse(rawText(answer)) as { ok: boolean; commitToken?: string; validation?: { errors?: string[] } };
    expect(body.ok).toBe(false);
    expect(body.commitToken).toBeUndefined();
    expect(body.validation?.errors?.join('\n')).toContain('Only adults');
    await server.close();
  });

  it('refuses the granular rename and removal too', async () => {
    const { server, call, paths } = await setup();
    const renamed = await call('update_state_definition', {
      featureId: VALIDATION.feature,
      surfaceId: VALIDATION.surface,
      stateDefinitionId: 'sd-age',
      path: 'profile.years'
    });
    expect(errored(renamed)).toBe(true);
    expect(rawText(renamed)).toContain('Only adults');
    const removed = await call('remove_state_definition', {
      featureId: VALIDATION.feature,
      surfaceId: VALIDATION.surface,
      stateDefinitionId: 'sd-age'
    });
    expect(errored(removed)).toBe(true);
    expect(await paths()).toContain('profile.age');
    await server.close();
  });

  it('lets a path go when another feature of the project still declares it', async () => {
    const { server, call } = await setup();
    // Not a loss: the same batch declares the path again elsewhere in the feature.
    const answer = await call('apply_batch', {
      featureId: VALIDATION.feature,
      operations: [
        { kind: 'update_state_definition', surfaceId: VALIDATION.surface, stateDefinitionId: 'sd-age', path: 'profile.years' },
        { kind: 'add_state_definition', surfaceId: VALIDATION.surface, path: 'profile.age', type: 'number', defaultValue: 20, description: 'The age, kept for the project rule.' }
      ]
    });
    expect(JSON.parse(rawText(answer)).ok).toBe(true);
    await server.close();
  });
});

describe('save_feature, the full replace', () => {
  it('refuses a replacement that drops the last declaration', async () => {
    const { server, call, paths } = await setup();
    const current = JSON.parse(rawText(await call('get_feature', { featureId: VALIDATION.feature, verbose: true }))) as Record<string, unknown>;
    const feature = (current.feature ?? current) as { surfaces: { stateDefinitions: { path: string }[] }[] };
    const replaced = {
      ...feature,
      surfaces: feature.surfaces.map((s) => ({ ...s, stateDefinitions: s.stateDefinitions.filter((d) => d.path !== 'profile.age') }))
    };
    const answer = await call('save_feature', { feature: replaced });
    expect(errored(answer)).toBe(true);
    expect(rawText(answer)).toContain('Only adults');
    expect(await paths()).toContain('profile.age');
    await server.close();
  });
});
