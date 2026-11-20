import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fixedClock } from '../../src/shared/domain/Clock';
import { InMemoryFeatureRepository } from '../../src/features/behavior-model/infrastructure/persistence/InMemoryFeatureRepository';
import { InMemoryProjectRepository } from '../../src/features/projects/infrastructure/persistence/InMemoryProjectRepository';
import type { Project } from '../../src/features/projects/domain/entities/Project';
import type { ProjectId } from '../../src/features/projects/domain/value-objects/ids';
import { asFeatureId } from '../../src/features/behavior-model/domain/value-objects/ids';
import { VALIDATION, validationFeature } from '../../src/features/behavior-model/domain/services/DisabledElements.fixture';
import { buildServer } from '../server';

/**
 * The status record keeps what the last sync located per action and surface.
 * A reader (the coverage of a feature is tallied from it) takes it against the
 * spec as it is NOW: a report of an action the spec no longer has is counted
 * apart, never as coverage, and a rule added after the sync reads missing.
 */

const NOW = '2026-11-20T10:00:00.000Z';
const PROJECT_ID = 'proj-validation' as ProjectId;

const parse = <T = Record<string, unknown>>(r: unknown): T => {
  const content = (r as { content?: readonly { type: string; text: string }[] }).content;
  return JSON.parse(content?.[0]?.text ?? 'null') as T;
};

const INDEX = {
  [`surface:${VALIDATION.surface}`]: { status: 'implemented', file: 'src/element.ts', line: 1, signature: 'export const element = {' },
  'state:session.role': { status: 'implemented', file: 'src/element.ts', line: 2, signature: 'role: Role;' },
  'state:element.validated': { status: 'implemented', file: 'src/element.ts', line: 3, signature: 'validated: boolean;' },
  [`action:${VALIDATION.validate}`]: { status: 'implemented', file: 'src/validate.ts', line: 3, signature: 'export function validate() {' },
  [`rule:${VALIDATION.viewerRule}`]: { status: 'implemented', file: 'src/validate.ts', line: 4, signature: "if (role === 'viewer') throw refused();" },
  [`action:${VALIDATION.reopen}`]: { status: 'implemented', file: 'src/reopen.ts', line: 3, signature: 'export function reopen() {', verifiedAt: NOW },
  [`rule:${VALIDATION.reopenRule}`]: { status: 'implemented', file: 'src/reopen.ts', line: 4, signature: 'allow();' }
};

type Row = { actionId?: string; surfaceId?: string; expectedEntities: unknown[]; foundEntities: unknown[]; missingEntities: { entityId: string }[] };
type Status = { actions: Row[]; surfaces: Row[]; verified: { actions: number; total: number }; orphanedReports?: { actions: string[]; surfaces: string[] } };

const setup = async () => {
  const repo = new InMemoryFeatureRepository();
  await repo.save(validationFeature());
  const projectRepo = new InMemoryProjectRepository();
  const project: Project = {
    id: PROJECT_ID,
    name: 'Validation',
    description: 'Owns the validation feature.',
    featureIds: [asFeatureId(VALIDATION.feature)],
    createdAt: NOW,
    updatedAt: NOW
  };
  await projectRepo.save(project);
  let n = 0;
  const server = buildServer(repo, { ids: () => `id-${n++}`, clock: fixedClock(NOW), projectRepo });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
  const batch = (operations: Record<string, unknown>[]) => call('apply_batch', { featureId: VALIDATION.feature, operations });
  const status = async () => parse<Status>(await call('get_implementation_status', { featureId: VALIDATION.feature }));
  return { server, call, batch, status };
};

describe('get_implementation_status reads the record against the spec as it is now', () => {
  it('leaves out, and counts apart, the report of an action the spec no longer has', async () => {
    const { server, call, batch, status } = await setup();
    await call('sync_from_index', { index: INDEX, projectId: PROJECT_ID });
    expect((await status()).actions.map((a) => a.actionId).sort()).toEqual([VALIDATION.reopen, VALIDATION.validate]);

    await batch([{ kind: 'remove_action', surfaceId: VALIDATION.surface, actionId: VALIDATION.reopen }]);
    const read = await status();
    expect(read.actions.map((a) => a.actionId)).toEqual([VALIDATION.validate]);
    expect(read.orphanedReports).toEqual({ actions: [VALIDATION.reopen], surfaces: [] });
    // The removed action carried the only proof: it proves nothing now.
    expect(read.verified).toEqual({ actions: 0, total: 1 });
    await server.close();
  });

  it('reads missing a rule added after the sync, and drops one the spec removed', async () => {
    const { server, call, batch, status } = await setup();
    await call('sync_from_index', { index: INDEX, projectId: PROJECT_ID });
    const res = await batch([
      {
        kind: 'add_action_rule',
        surfaceId: VALIDATION.surface,
        actionId: VALIDATION.validate,
        ref: 'r1',
        rule: {
          category: 'business',
          condition: { left: 'element.validated', operator: 'is_true' },
          effect: { type: 'block_action', reason: 'Already validated.' },
          description: 'An element validated already is not validated again.'
        }
      },
      { kind: 'remove_action_rule', surfaceId: VALIDATION.surface, actionId: VALIDATION.reopen, ruleId: VALIDATION.reopenRule }
    ]);
    const added = (parse<{ refs: Record<string, string> }>(res)).refs.r1!;
    const read = await status();
    const validate = read.actions.find((a) => a.actionId === VALIDATION.validate)!;
    expect(validate.missingEntities.map((e) => e.entityId)).toEqual([added]);
    expect(validate.expectedEntities).toHaveLength(3);
    expect(validate.foundEntities).toHaveLength(2);
    const reopen = read.actions.find((a) => a.actionId === VALIDATION.reopen)!;
    expect(reopen.expectedEntities).toHaveLength(1);
    expect(reopen.foundEntities).toHaveLength(1);
    await server.close();
  });
});
