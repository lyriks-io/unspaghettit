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
 * Integration coverage for the implement-next queue tools (enqueue, dequeue,
 * reorder_queue, set_queue_target, list_queue, get_next_queued). These were
 * exercised only indirectly before; here we drive them through the real MCP
 * Client so the registration → handler → use-case → project-repo path is
 * verified end-to-end, including the error envelopes and idempotency contracts
 * the tool descriptions promise.
 */

const PROJECT_ID = 'proj-shop' as ProjectId;
const SURFACE_CART = 'seed-shop-cart';
const ACTION_ADD = 'seed-shop-cap-add-to-cart';

let nextId = 0;
const fixedIds = () => `q-id-${nextId++}`;

const rawText = (r: unknown): string => {
  const content = (r as { content?: readonly { type: string; text: string }[] }).content;
  const first = content?.[0];
  if (!first || first.type !== 'text') throw new Error('expected text content');
  return first.text;
};
const parse = <T = Record<string, unknown>>(r: unknown): T => JSON.parse(rawText(r)) as T;
const errored = (r: unknown): boolean => (r as { isError?: boolean }).isError === true;

const setup = async (opts: { withLink?: boolean; ownsFeature?: boolean } = {}) => {
  nextId = 0;
  const repo = new InMemoryFeatureRepository();
  await repo.save(storefrontFeature);
  const projectRepo = new InMemoryProjectRepository();
  const project: Project = {
    id: PROJECT_ID,
    name: 'Shop',
    description: 'A project that owns the storefront feature.',
    featureIds: opts.ownsFeature === false ? [] : [storefrontFeature.id],
    createdAt: '2026-05-09T00:00:00.000Z',
    updatedAt: '2026-05-09T00:00:00.000Z'
  };
  await projectRepo.save(project);
  const server = buildServer(repo, {
    ids: fixedIds,
    clock: fixedClock('2026-05-09T00:00:00.000Z'),
    projectRepo,
    ...(opts.withLink
      ? {
          repoContext: {
            cwd: '/tmp/shop',
            linkPath: '/tmp/shop/.unspa.json',
            link: { projectId: String(PROJECT_ID), projectName: 'Shop' }
          }
        }
      : {})
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server, repo, projectRepo };
};

const enqueue = (
  client: Client,
  args: Record<string, unknown>
) => client.callTool({ name: 'enqueue', arguments: { projectId: String(PROJECT_ID), ...args } });

describe('queue tools', () => {
  it('enqueues a feature and is idempotent on re-queue', async () => {
    const { client, server } = await setup();
    const first = parse<{ ok: boolean; alreadyQueued: boolean; queueLength: number }>(
      await enqueue(client, { kind: 'feature', featureId: storefrontFeature.id })
    );
    expect(first.ok).toBe(true);
    expect(first.alreadyQueued).toBe(false);
    expect(first.queueLength).toBe(1);

    const again = parse<{ alreadyQueued: boolean; queueLength: number }>(
      await enqueue(client, { kind: 'feature', featureId: storefrontFeature.id })
    );
    expect(again.alreadyQueued).toBe(true);
    expect(again.queueLength).toBe(1);
    await server.close();
  });

  it('rejects kind="surface" without a surfaceId', async () => {
    const { client, server } = await setup();
    const res = await enqueue(client, { kind: 'surface', featureId: storefrontFeature.id });
    expect(errored(res)).toBe(true);
    expect(rawText(res)).toContain('surfaceId is required');
    await server.close();
  });

  it('rejects kind="action" without an actionId', async () => {
    const { client, server } = await setup();
    const res = await enqueue(client, { kind: 'action', featureId: storefrontFeature.id });
    expect(errored(res)).toBe(true);
    expect(rawText(res)).toContain('actionId is required');
    await server.close();
  });

  it('falls back to the linked project when no projectId is given', async () => {
    const { client, server } = await setup({ withLink: true });
    const res = parse<{ ok: boolean; projectId: string }>(
      await client.callTool({
        name: 'enqueue',
        arguments: { kind: 'feature', featureId: storefrontFeature.id }
      })
    );
    expect(res.ok).toBe(true);
    expect(res.projectId).toBe(String(PROJECT_ID));
    await server.close();
  });

  it('errors with a hint when neither projectId nor a link is available', async () => {
    const { client, server } = await setup(); // no repo link
    const res = await client.callTool({
      name: 'enqueue',
      arguments: { kind: 'feature', featureId: storefrontFeature.id }
    });
    expect(errored(res)).toBe(true);
    expect(rawText(res)).toContain('No projectId');
    await server.close();
  });

  it('errors when the feature is not a member of the project', async () => {
    const { client, server } = await setup({ ownsFeature: false });
    const res = await enqueue(client, { kind: 'feature', featureId: storefrontFeature.id });
    expect(errored(res)).toBe(true);
    await server.close();
  });

  it('runs the full enqueue → list → reorder → target → dequeue lifecycle', async () => {
    const { client, server } = await setup();

    const feat = parse<{ itemId: string }>(
      await enqueue(client, { kind: 'feature', featureId: storefrontFeature.id })
    );
    const surf = parse<{ itemId: string }>(
      await enqueue(client, { kind: 'surface', featureId: storefrontFeature.id, surfaceId: SURFACE_CART })
    );
    const act = parse<{ itemId: string }>(
      await enqueue(client, { kind: 'action', featureId: storefrontFeature.id, actionId: ACTION_ADD })
    );

    // list_queue returns all three in insertion order.
    const listed = parse<{ total: number; shown: number; queue: readonly { id: string }[] }>(
      await client.callTool({ name: 'list_queue', arguments: { projectId: String(PROJECT_ID) } })
    );
    expect(listed.total).toBe(3);
    expect(listed.queue.map((q) => q.id)).toEqual([feat.itemId, surf.itemId, act.itemId]);

    // get_next_queued peeks the head without mutating.
    const peek = parse<{ next: { id: string } | null }>(
      await client.callTool({ name: 'get_next_queued', arguments: { projectId: String(PROJECT_ID) } })
    );
    expect(peek.next?.id).toBe(feat.itemId);

    // reorder by absolute index: move the action to the front.
    const reordered = parse<{ order: readonly string[] }>(
      await client.callTool({
        name: 'reorder_queue',
        arguments: { projectId: String(PROJECT_ID), queueItemId: act.itemId, targetIndex: 0 }
      })
    );
    expect(reordered.order[0]).toBe(act.itemId);

    // pin an implementation goal, then confirm it surfaces in list_queue.
    const withTarget = parse<{ ok: boolean; goal: string | null }>(
      await client.callTool({
        name: 'set_queue_target',
        arguments: { projectId: String(PROJECT_ID), queueItemId: feat.itemId, target: { implementation: 80 } }
      })
    );
    expect(withTarget.ok).toBe(true);
    expect(withTarget.goal).toBeTruthy();

    const afterTarget = parse<{ queue: readonly { id: string; goal?: string }[] }>(
      await client.callTool({ name: 'list_queue', arguments: { projectId: String(PROJECT_ID) } })
    );
    expect(afterTarget.queue.find((q) => q.id === feat.itemId)?.goal).toBeTruthy();

    // clearing the goal removes it again.
    const cleared = parse<{ target: unknown }>(
      await client.callTool({
        name: 'set_queue_target',
        arguments: { projectId: String(PROJECT_ID), queueItemId: feat.itemId, clear: true }
      })
    );
    expect(cleared.target).toBeNull();

    // dequeue is idempotent: removing the same id twice doesn't underflow.
    const removed = parse<{ queueLength: number }>(
      await client.callTool({
        name: 'dequeue',
        arguments: { projectId: String(PROJECT_ID), queueItemId: feat.itemId }
      })
    );
    expect(removed.queueLength).toBe(2);
    const removedAgain = parse<{ queueLength: number }>(
      await client.callTool({
        name: 'dequeue',
        arguments: { projectId: String(PROJECT_ID), queueItemId: feat.itemId }
      })
    );
    expect(removedAgain.queueLength).toBe(2);

    await server.close();
  });

  it('reorder_queue requires exactly one of direction / targetIndex', async () => {
    const { client, server } = await setup();
    const item = parse<{ itemId: string }>(
      await enqueue(client, { kind: 'feature', featureId: storefrontFeature.id })
    );
    const neither = await client.callTool({
      name: 'reorder_queue',
      arguments: { projectId: String(PROJECT_ID), queueItemId: item.itemId }
    });
    expect(errored(neither)).toBe(true);
    const both = await client.callTool({
      name: 'reorder_queue',
      arguments: { projectId: String(PROJECT_ID), queueItemId: item.itemId, direction: 'up', targetIndex: 0 }
    });
    expect(errored(both)).toBe(true);
    await server.close();
  });

  it('set_queue_target requires either a target or clear:true', async () => {
    const { client, server } = await setup();
    const item = parse<{ itemId: string }>(
      await enqueue(client, { kind: 'feature', featureId: storefrontFeature.id })
    );
    const res = await client.callTool({
      name: 'set_queue_target',
      arguments: { projectId: String(PROJECT_ID), queueItemId: item.itemId }
    });
    expect(errored(res)).toBe(true);
    await server.close();
  });

  it('get_next_queued returns null on an empty queue', async () => {
    const { client, server } = await setup();
    const res = parse<{ next: unknown }>(
      await client.callTool({ name: 'get_next_queued', arguments: { projectId: String(PROJECT_ID) } })
    );
    expect(res.next).toBeNull();
    await server.close();
  });
});
