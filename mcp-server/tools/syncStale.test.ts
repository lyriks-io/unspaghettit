import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fixedClock } from '../../src/shared/domain/Clock';
import { InMemoryFeatureRepository } from '../../src/features/behavior-model/infrastructure/persistence/InMemoryFeatureRepository';
import { InMemoryProjectRepository } from '../../src/features/projects/infrastructure/persistence/InMemoryProjectRepository';
import type { Project } from '../../src/features/projects/domain/entities/Project';
import type { ProjectId } from '../../src/features/projects/domain/value-objects/ids';
import { asFeatureId } from '../../src/features/behavior-model/domain/value-objects/ids';
import { asEventName } from '../../src/features/behavior-model/domain/value-objects/EventName';
import { VALIDATION, validationFeature } from '../../src/features/behavior-model/domain/services/DisabledElements.fixture';
import { buildServer } from '../server';

/**
 * A child key several parents declare (an event two actions emit, a state path
 * several surfaces share) is ONE index entry. Each parent locates it, and each
 * location used to add a row to `stale`, so one entry whose signature moved
 * away read as several stale entries.
 */

const NOW = '2026-11-20T10:00:00.000Z';
const PROJECT_ID = 'proj-validation';

describe('sync_from_index stale block', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'unspa-sync-stale-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lists a stale entry once, however many parents declare its key', async () => {
    mkdirSync(join(root, 'src'));
    writeFileSync(
      join(root, 'src/element.ts'),
      [
        'export function validate() {',
        "  if (role === 'viewer') throw refused();",
        '}',
        'export function reopen() {',
        '  allow();',
        '}'
      ].join('\n')
    );
    const index = {
      [`action:${VALIDATION.validate}`]: { status: 'implemented', file: 'src/element.ts', line: 1, signature: 'export function validate() {' },
      [`rule:${VALIDATION.viewerRule}`]: { status: 'implemented', file: 'src/element.ts', line: 2, signature: "if (role === 'viewer') throw refused();" },
      [`action:${VALIDATION.reopen}`]: { status: 'implemented', file: 'src/element.ts', line: 4, signature: 'export function reopen() {' },
      [`rule:${VALIDATION.reopenRule}`]: { status: 'implemented', file: 'src/element.ts', line: 5, signature: 'allow();' },
      // Its emission was rewritten: the signature is nowhere in the file now.
      'event:element.changed': { status: 'implemented', file: 'src/element.ts', line: 3, signature: "emit('element.changed', element);" }
    };
    writeFileSync(join(root, '.unspa.json'), JSON.stringify({ projectId: PROJECT_ID, index }, null, 2));

    const base = validationFeature();
    const repo = new InMemoryFeatureRepository();
    await repo.save({
      ...base,
      surfaces: base.surfaces.map((s) => ({
        ...s,
        actions: s.actions.map((a) => ({ ...a, emittedEvents: [asEventName('element.changed')] }))
      }))
    });
    const projectRepo = new InMemoryProjectRepository();
    const project: Project = {
      id: PROJECT_ID as ProjectId,
      name: 'Validation',
      description: 'Owns the validation feature.',
      featureIds: [asFeatureId(VALIDATION.feature)],
      createdAt: NOW,
      updatedAt: NOW
    };
    await projectRepo.save(project);
    const server = buildServer(repo, {
      ids: () => 'id',
      clock: fixedClock(NOW),
      projectRepo,
      repoContext: {
        cwd: root,
        linkPath: join(root, '.unspa.json'),
        link: { projectId: PROJECT_ID, projectName: 'Validation' }
      }
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: 'sync_from_index', arguments: {} });
    const content = (result as { content: { text: string }[] }).content[0]!.text;
    const answer = JSON.parse(content) as { stale: { total: number; unhealable: number; entries: { key: string }[] } };
    expect(answer.stale.entries.map((e) => e.key)).toEqual(['event:element.changed']);
    expect(answer.stale.total).toBe(1);
    expect(answer.stale.unhealable).toBe(1);
    await server.close();
  });
});
