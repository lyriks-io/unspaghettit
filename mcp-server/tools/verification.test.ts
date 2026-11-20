import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fixedClock } from '../../src/shared/domain/Clock';
import { InMemoryFeatureRepository } from '../../src/features/behavior-model/infrastructure/persistence/InMemoryFeatureRepository';
import { storefrontFeature } from '../../src/features/behavior-model/infrastructure/seed/seedStorefront';
import { InMemoryProjectRepository } from '../../src/features/projects/infrastructure/persistence/InMemoryProjectRepository';
import { buildServer } from '../server';

/**
 * verify and get_drift scoped to a feature that does not exist answer that it
 * does not exist: they used to fall back to every feature of the store, so a
 * mistyped or removed feature read as a verdict on all the others.
 */

const rawText = (r: unknown): string => {
  const content = (r as { content?: readonly { type: string; text: string }[] }).content;
  const first = content?.[0];
  if (!first || first.type !== 'text') throw new Error('expected text content');
  return first.text;
};
const errored = (r: unknown): boolean => (r as { isError?: boolean }).isError === true;

const setup = async () => {
  const repo = new InMemoryFeatureRepository();
  await repo.save(storefrontFeature);
  const server = buildServer(repo, {
    ids: () => 'id',
    clock: fixedClock('2026-11-20T00:00:00.000Z'),
    projectRepo: new InMemoryProjectRepository()
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
};

describe('verification tools scoped to a feature', () => {
  it('verify refuses a feature that does not exist instead of verifying every feature', async () => {
    const { client, server } = await setup();
    const res = await client.callTool({ name: 'verify', arguments: { featureId: 'feature-that-does-not-exist-0000000000' } });
    expect(errored(res)).toBe(true);
    expect(rawText(res)).toContain('Feature feature-that-does-not-exist-0000000000 not found');
    await server.close();
  });

  it('get_drift refuses a feature that does not exist', async () => {
    const { client, server } = await setup();
    const res = await client.callTool({ name: 'get_drift', arguments: { featureId: 'nope', index: {} } });
    expect(errored(res)).toBe(true);
    expect(rawText(res)).toContain('Feature nope not found');
    await server.close();
  });

  it('verify still verifies a feature that exists', async () => {
    const { client, server } = await setup();
    const res = await client.callTool({ name: 'verify', arguments: { featureId: String(storefrontFeature.id) } });
    expect(errored(res)).toBe(false);
    const report = JSON.parse(rawText(res)) as { summary: { featuresChecked: number } };
    expect(report.summary.featuresChecked).toBe(1);
    await server.close();
  });
});
