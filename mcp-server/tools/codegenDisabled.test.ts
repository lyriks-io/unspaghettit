import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fixedClock } from '../../src/shared/domain/Clock';
import { InMemoryFeatureRepository } from '../../src/features/behavior-model/infrastructure/persistence/InMemoryFeatureRepository';
import {
  VALIDATION,
  validationFeature
} from '../../src/features/behavior-model/domain/services/DisabledElements.fixture';
import { buildServer } from '../server';

/**
 * The types module apply_batch writes again after every batch (once
 * generate_types chose its path) is generated from the operative model, like
 * generate_types itself: a disabled action has no parameter shape there, and
 * the file does not change with the tool that wrote it last.
 */

const NOW = '2026-11-18T10:00:00.000Z';
const OUT = 'src/generated/validation.ts';

const setup = async () => {
  const root = mkdtempSync(join(tmpdir(), 'unspa-codegen-'));
  const linkPath = join(root, '.unspa.json');
  writeFileSync(linkPath, JSON.stringify({ version: 1, entries: {} }));
  const repo = new InMemoryFeatureRepository();
  await repo.save(validationFeature());
  let n = 0;
  const server = buildServer(repo, {
    ids: () => `id-${n++}`,
    clock: fixedClock(NOW),
    repoContext: { cwd: root, link: null, linkPath }
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
  const generated = () => readFileSync(join(root, OUT), 'utf8');
  return { server, call, generated };
};

describe('the types apply_batch regenerates', () => {
  it('leave out the parameter shape of an action the batch disabled', async () => {
    const { server, call, generated } = await setup();
    await call('apply_batch', {
      featureId: VALIDATION.feature,
      operations: [
        { kind: 'add_parameter', surfaceId: VALIDATION.surface, actionId: VALIDATION.reopen, name: 'note', type: 'string', required: false, description: 'Why it is reopened.' }
      ]
    });
    await call('generate_types', { featureId: VALIDATION.feature, outputPath: OUT });
    expect(generated()).toContain('ReopenTheElementParams');
    await call('apply_batch', {
      featureId: VALIDATION.feature,
      operations: [{ kind: 'disable_element', elementId: VALIDATION.reopen, reason: 'Reopening waits for the audit.' }]
    });
    expect(generated()).not.toContain('ReopenTheElementParams');
    await server.close();
  });
});
