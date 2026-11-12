import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fixedClock } from '../../src/shared/domain/Clock';
import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import { asEntityId, asFeatureId } from '../../src/features/behavior-model/domain/value-objects/ids';
import { InMemoryFeatureRepository } from '../../src/features/behavior-model/infrastructure/persistence/InMemoryFeatureRepository';
import type { Project } from '../../src/features/projects/domain/entities/Project';
import { asProjectId } from '../../src/features/projects/domain/value-objects/ids';
import { InMemoryProjectRepository } from '../../src/features/projects/infrastructure/persistence/InMemoryProjectRepository';
import { buildServer } from '../server';

const now = '2026-11-13T00:00:00.000Z';
const feature = (id: string): Feature => ({
  id: asFeatureId(id), name: id, description: 'A project capability.',
  surfaces: [], resources: [], personas: [], events: [],
  entities: [{ id: asEntityId(`entity-${id}`), namespace: 'order', description: 'A customer order.', fields: [] }],
  createdAt: now, updatedAt: now
});
const project = (id: string, featureIds: string[]): Project => ({
  id: asProjectId(id), name: id, featureIds: featureIds.map(asFeatureId), createdAt: now, updatedAt: now
});
const closes: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of closes.splice(0)) await close(); });

async function setup(ambiguousSibling = false, ambiguousSource = false) {
  const repo = new InMemoryFeatureRepository();
  const projects = new InMemoryProjectRepository();
  for (const id of ['source', 'sibling', 'foreign']) await repo.save(feature(id));
  await projects.save(project('allowed', ['source', 'sibling']));
  await projects.save(project('other', ['foreign', ...(ambiguousSibling ? ['sibling'] : []), ...(ambiguousSource ? ['source'] : [])]));
  const server = buildServer(repo, { projectRepo: projects, clock: fixedClock(now) });
  const client = new Client({ name: 'promotion-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  closes.push(async () => { await client.close(); await server.close(); });
  const featureSave = vi.spyOn(repo, 'save');
  const projectSave = vi.spyOn(projects, 'save');
  const promote = (featureId = 'source') => client.callTool({
    name: 'promote_to_project_library',
    arguments: { expectedProjectId: 'allowed', featureId, kind: 'entity', id: `entity-${featureId}` }
  });
  return { repo, projects, featureSave, projectSave, promote };
}

describe('promotion project boundary', () => {
  it('rejects a source outside the expected project before any write [unspa:628f3070:8a4449b2:a3f7ede6]', async () => {
    const { promote, featureSave, projectSave } = await setup();
    expect(await promote('foreign')).toMatchObject({ isError: true });
    expect(featureSave).not.toHaveBeenCalled();
    expect(projectSave).not.toHaveBeenCalled();
  });

  it('rejects an ambiguously owned source before any write', async () => {
    const { promote, featureSave, projectSave } = await setup(false, true);
    expect(await promote()).toMatchObject({ isError: true });
    expect(featureSave).not.toHaveBeenCalled();
    expect(projectSave).not.toHaveBeenCalled();
  });

  it('rejects an ambiguous deduplication target before any write [unspa:628f3070:8a4449b2:990d6416]', async () => {
    const { promote, featureSave, projectSave } = await setup(true);
    expect(await promote()).toMatchObject({ isError: true });
    expect(featureSave).not.toHaveBeenCalled();
    expect(projectSave).not.toHaveBeenCalled();
  });

  it('promotes and deduplicates only the authorized project', async () => {
    const { repo, projects, promote } = await setup();
    const result = await promote() as { content: { text: string }[] };
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ ok: true, projectId: 'allowed', rewrittenFeatures: ['source', 'sibling'] });
    expect((await projects.get(asProjectId('allowed')))?.entities).toHaveLength(1);
    expect((await repo.get(asFeatureId('sibling')))?.entityRefs).toEqual(['entity-source']);
    expect((await repo.get(asFeatureId('foreign')))?.entities).toHaveLength(1);
    expect((await projects.get(asProjectId('other')))?.entities).toBeUndefined();
  });
});
