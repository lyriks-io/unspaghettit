import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fixedClock } from '../../src/shared/domain/Clock';
import { InMemoryFeatureRepository } from '../../src/features/behavior-model/infrastructure/persistence/InMemoryFeatureRepository';
import {
  asEntityFieldId,
  asEntityId,
  asStateDefinitionId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '../../src/features/behavior-model/domain/value-objects/StatePath';
import {
  VALIDATION,
  validationFeature
} from '../../src/features/behavior-model/domain/services/DisabledElements.fixture';
import { buildServer } from '../server';

/** apply_batch names the entity field a rename left on the old state path. */

const NOW = '2026-11-18T10:00:00.000Z';
const rawText = (r: unknown): string => (r as { content: { text: string }[] }).content[0]!.text;

describe('a batch renaming a state an entity field maps', () => {
  it('warns about the field', async () => {
    const repo = new InMemoryFeatureRepository();
    const base = validationFeature();
    await repo.save({
      ...base,
      surfaces: base.surfaces.map((s) => ({
        ...s,
        stateDefinitions: [
          ...s.stateDefinitions,
          { id: asStateDefinitionId('sd-age'), path: asStatePath('profile.age'), type: 'number', defaultValue: 20, description: 'The age.' }
        ]
      })),
      entities: [
        {
          id: asEntityId('ent-profile'),
          namespace: 'profile',
          description: 'The person signed in.',
          fields: [{ id: asEntityFieldId('fld-age'), name: 'age', type: 'number', path: asStatePath('profile.age') }]
        }
      ]
    });
    let n = 0;
    const server = buildServer(repo, { ids: () => `id-${n++}`, clock: fixedClock(NOW) });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const answer = JSON.parse(
      rawText(
        await client.callTool({
          name: 'apply_batch',
          arguments: {
            featureId: VALIDATION.feature,
            operations: [{ kind: 'update_state_definition', surfaceId: VALIDATION.surface, stateDefinitionId: 'sd-age', path: 'profile.years' }]
          }
        })
      )
    ) as { ok: boolean; warnings?: string[] };
    expect(answer.ok).toBe(true);
    expect((answer.warnings ?? []).join('\n')).toContain('Entity "profile" field "age"');
    await server.close();
  });
});
