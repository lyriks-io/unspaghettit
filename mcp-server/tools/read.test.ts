import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fixedClock } from '../../src/shared/domain/Clock';
import { InMemoryFeatureRepository } from '../../src/features/behavior-model/infrastructure/persistence/InMemoryFeatureRepository';
import { storefrontFeature } from '../../src/features/behavior-model/infrastructure/seed/seedStorefront';
import { InMemoryProjectRepository } from '../../src/features/projects/infrastructure/persistence/InMemoryProjectRepository';
import type { Project } from '../../src/features/projects/domain/entities/Project';
import type { ProjectId } from '../../src/features/projects/domain/value-objects/ids';
import { buildServer } from '../server';

/**
 * Integration coverage for the read/query tool wrappers (read.ts). The pure
 * projection functions live in src/features/mcp-tools and are unit-tested
 * there; what's verified here is the wrapper layer those tests can't reach:
 * not-found errors, the projectId filter on list_features, the
 * actionId/actionIds branching on get_action, state-path validation on
 * find_state_references, and the index-vs-verbose switch on get_surface.
 */

const PROJECT_ID = 'proj-shop' as ProjectId;
const SURFACE_CART = 'seed-shop-cart';
const SURFACE_CATALOG = 'seed-shop-catalog';
const ACTION_ADD = 'seed-shop-cap-add-to-cart';
const ACTION_SEARCH = 'seed-shop-cap-search';

let nextId = 0;
const fixedIds = () => `r-id-${nextId++}`;

const rawText = (r: unknown): string => {
  const content = (r as { content?: readonly { type: string; text: string }[] }).content;
  const first = content?.[0];
  if (!first || first.type !== 'text') throw new Error('expected text content');
  return first.text;
};
const parse = <T = Record<string, unknown>>(r: unknown): T => JSON.parse(rawText(r)) as T;
const errored = (r: unknown): boolean => (r as { isError?: boolean }).isError === true;

const setup = async () => {
  nextId = 0;
  const repo = new InMemoryFeatureRepository();
  await repo.save(storefrontFeature);
  const projectRepo = new InMemoryProjectRepository();
  const project: Project = {
    id: PROJECT_ID,
    name: 'Shop',
    description: 'A project that owns the storefront feature.',
    featureIds: [storefrontFeature.id],
    createdAt: '2026-05-09T00:00:00.000Z',
    updatedAt: '2026-05-09T00:00:00.000Z'
  };
  await projectRepo.save(project);
  const server = buildServer(repo, {
    ids: fixedIds,
    clock: fixedClock('2026-05-09T00:00:00.000Z'),
    projectRepo
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
};

describe('read tools', () => {
  it('get_feature reports a clear error for an unknown feature', async () => {
    const { client, server } = await setup();
    const res = await client.callTool({ name: 'get_feature', arguments: { featureId: 'does-not-exist' } });
    expect(errored(res)).toBe(true);
    expect(rawText(res)).toContain('not found');
    await server.close();
  });

  it('list_features filters to a project\'s members when projectId is given', async () => {
    const { client, server } = await setup();
    const all = parse<readonly { id: string }[]>(
      await client.callTool({ name: 'list_features', arguments: {} })
    );
    expect(all.map((f) => f.id)).toContain(String(storefrontFeature.id));

    const scoped = parse<readonly { id: string }[]>(
      await client.callTool({ name: 'list_features', arguments: { projectId: String(PROJECT_ID) } })
    );
    expect(scoped.map((f) => f.id)).toEqual([String(storefrontFeature.id)]);
    await server.close();
  });

  it('list_features errors on an unknown projectId', async () => {
    const { client, server } = await setup();
    const res = await client.callTool({
      name: 'list_features',
      arguments: { projectId: 'no-such-project' }
    });
    expect(errored(res)).toBe(true);
    await server.close();
  });

  it('get_action requires exactly one of actionId / actionIds', async () => {
    const { client, server } = await setup();
    const both = await client.callTool({
      name: 'get_action',
      arguments: { featureId: storefrontFeature.id, actionId: ACTION_ADD, actionIds: [ACTION_SEARCH] }
    });
    expect(errored(both)).toBe(true);

    const neither = await client.callTool({
      name: 'get_action',
      arguments: { featureId: storefrontFeature.id }
    });
    expect(errored(neither)).toBe(true);

    const empty = await client.callTool({
      name: 'get_action',
      arguments: { featureId: storefrontFeature.id, actionIds: [] }
    });
    expect(errored(empty)).toBe(true);
    await server.close();
  });

  it('get_action returns a single action and a deduped bulk fetch', async () => {
    const { client, server } = await setup();
    const single = parse<{ action: { id: string } }>(
      await client.callTool({
        name: 'get_action',
        arguments: { featureId: storefrontFeature.id, actionId: ACTION_ADD }
      })
    );
    expect(single.action.id).toBe(ACTION_ADD);

    const bulk = parse<{ actions: readonly { actionId: string }[] }>(
      await client.callTool({
        name: 'get_action',
        arguments: { featureId: storefrontFeature.id, actionIds: [ACTION_ADD, ACTION_SEARCH] }
      })
    );
    expect(bulk.actions.map((a) => a.actionId).sort()).toEqual([ACTION_ADD, ACTION_SEARCH].sort());
    await server.close();
  });

  it('list_actions can scope to a single surface', async () => {
    const { client, server } = await setup();
    const all = parse<readonly { surfaceId: string }[]>(
      await client.callTool({ name: 'list_actions', arguments: { featureId: storefrontFeature.id } })
    );
    const scoped = parse<readonly { surfaceId: string }[]>(
      await client.callTool({
        name: 'list_actions',
        arguments: { featureId: storefrontFeature.id, surfaceId: SURFACE_CATALOG }
      })
    );
    expect(all.length).toBeGreaterThanOrEqual(scoped.length);
    expect(scoped.length).toBeGreaterThan(0);
    // The filter is honored: every returned action lives on the requested surface.
    expect(scoped.every((a) => a.surfaceId === SURFACE_CATALOG)).toBe(true);
    await server.close();
  });

  it('find_state_references counts a real path and rejects an invalid one', async () => {
    const { client, server } = await setup();
    const refs = parse<Record<string, unknown>>(
      await client.callTool({
        name: 'find_state_references',
        arguments: { featureId: storefrontFeature.id, statePath: 'cart.itemCount' }
      })
    );
    expect(refs).toBeTruthy();

    const bad = await client.callTool({
      name: 'find_state_references',
      arguments: { featureId: storefrontFeature.id, statePath: 'cart itemCount' }
    });
    expect(errored(bad)).toBe(true);
    expect(rawText(bad)).toContain('Invalid state path');
    await server.close();
  });

  it('get_surface returns an index by default and a fuller tree when verbose', async () => {
    const { client, server } = await setup();
    const index = parse<Record<string, unknown>>(
      await client.callTool({
        name: 'get_surface',
        arguments: { featureId: storefrontFeature.id, surfaceId: SURFACE_CART }
      })
    );
    const verbose = parse<Record<string, unknown>>(
      await client.callTool({
        name: 'get_surface',
        arguments: { featureId: storefrontFeature.id, surfaceId: SURFACE_CART, verbose: true }
      })
    );
    expect(index).toBeTruthy();
    expect(verbose).toBeTruthy();
    // The verbose tree carries strictly more keys than the compact index.
    expect(JSON.stringify(verbose).length).toBeGreaterThan(JSON.stringify(index).length);

    const missing = await client.callTool({
      name: 'get_surface',
      arguments: { featureId: storefrontFeature.id, surfaceId: 'no-such-surface' }
    });
    expect(errored(missing)).toBe(true);
    await server.close();
  });

  it('get_neighborhood walks from an action root and errors on a bad root', async () => {
    const { client, server } = await setup();
    const hood = parse<Record<string, unknown>>(
      await client.callTool({
        name: 'get_neighborhood',
        arguments: { featureId: storefrontFeature.id, rootKey: `action:${ACTION_ADD}`, depth: 1 }
      })
    );
    expect(hood).toBeTruthy();

    const bad = await client.callTool({
      name: 'get_neighborhood',
      arguments: { featureId: storefrontFeature.id, rootKey: 'action:nope' }
    });
    expect(errored(bad)).toBe(true);
    await server.close();
  });
});
