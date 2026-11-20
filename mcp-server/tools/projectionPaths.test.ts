import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fixedClock } from '../../src/shared/domain/Clock';
import { InMemoryFeatureRepository } from '../../src/features/behavior-model/infrastructure/persistence/InMemoryFeatureRepository';
import { InMemoryProjectRepository } from '../../src/features/projects/infrastructure/persistence/InMemoryProjectRepository';
import type { Project } from '../../src/features/projects/domain/entities/Project';
import type { ProjectId } from '../../src/features/projects/domain/value-objects/ids';
import { asStateVariableId } from '../../src/features/projects/domain/value-objects/ids';
import {
  asFeatureId,
  asStateDefinitionId,
  asSurfaceId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '../../src/features/behavior-model/domain/value-objects/StatePath';
import {
  VALIDATION,
  validationFeature
} from '../../src/features/behavior-model/domain/services/DisabledElements.fixture';
import { buildServer } from '../server';

/**
 * Renaming one side of a shared state (the project's state variable, or the
 * feature definition that projects it) leaves the two under different paths:
 * the batch that does it says so, and so do the registry and the spec gaps.
 */

const NOW = '2026-11-18T10:00:00.000Z';
const rawText = (r: unknown): string => (r as { content: { text: string }[] }).content[0]!.text;

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
          stateVariableId: asStateVariableId('sv-age'),
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
    id: 'proj-shared' as ProjectId,
    name: 'Shared',
    description: 'Shares the age.',
    featureIds: [asFeatureId(VALIDATION.feature)],
    createdAt: NOW,
    updatedAt: NOW,
    stateVariables: [
      {
        id: asStateVariableId('sv-age'),
        path: asStatePath('profile.age'),
        type: 'number',
        defaultValue: 20,
        description: 'The age of the person signed in.',
        owner: { featureId: asFeatureId(VALIDATION.feature), surfaceId: asSurfaceId(VALIDATION.surface) },
        readers: [],
        writers: []
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
  return { server, call };
};

describe('a shared state renamed on one side only', () => {
  it('is a warning of the feature batch that renames the projection', async () => {
    const { server, call } = await setup();
    const answer = JSON.parse(
      rawText(
        await call('apply_batch', {
          featureId: VALIDATION.feature,
          operations: [
            { kind: 'update_state_definition', surfaceId: VALIDATION.surface, stateDefinitionId: 'sd-age', path: 'profile.years' }
          ]
        })
      )
    ) as { ok: boolean; warnings?: string[] };
    expect(answer.ok).toBe(true);
    expect((answer.warnings ?? []).join('\n')).toContain('"profile.years"');
    await server.close();
  });

  it('is a warning of the project batch that renames the shared state, then a critical gap', async () => {
    const { server, call } = await setup();
    const answer = JSON.parse(
      rawText(
        await call('apply_project_batch', {
          projectId: 'proj-shared',
          operations: [{ kind: 'update_state_variable', stateId: 'sv-age', path: 'profile.years' }]
        })
      )
    ) as { ok: boolean; warnings: string[] };
    expect(answer.ok).toBe(true);
    expect(answer.warnings.join('\n')).toContain('"profile.age"');
    const gaps = rawText(await call('get_spec_gaps', { featureId: VALIDATION.feature }));
    expect(gaps).toContain('state:projection-path-mismatch');
    await server.close();
  });
});
