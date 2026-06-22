import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fixedClock } from '../../src/shared/domain/Clock';
import { InMemoryFeatureRepository } from '../../src/features/behavior-model/infrastructure/persistence/InMemoryFeatureRepository';
import { storefrontFeature } from '../../src/features/behavior-model/infrastructure/seed/seedStorefront';
import { buildServer } from '../server';

/**
 * Add → update → remove round-trips for the entity-authoring write tools that
 * the integration suite (server.test.ts) doesn't touch: resource, persona,
 * event. Each round-trip asserts against the persisted Feature (via the repo)
 * so we know the mutation actually landed, the returned id is usable, and the
 * remove tears it back down — guarding the runMutation wrapper + the
 * FeatureTransforms it delegates to, end-to-end through the MCP envelope.
 */

let nextId = 0;
const fixedIds = () => `crud-id-${nextId++}`;

const rawText = (r: unknown): string => {
  const content = (r as { content?: readonly { type: string; text: string }[] }).content;
  const first = content?.[0];
  if (!first || first.type !== 'text') throw new Error('expected text content');
  return first.text;
};
const parse = <T = Record<string, unknown>>(r: unknown): T => JSON.parse(rawText(r)) as T;

const setup = async () => {
  nextId = 0;
  const repo = new InMemoryFeatureRepository();
  await repo.save(storefrontFeature);
  const server = buildServer(repo, {
    ids: fixedIds,
    clock: fixedClock('2026-05-09T00:00:00.000Z')
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server, repo };
};

const names = async (repo: InMemoryFeatureRepository, pick: 'resources' | 'personas' | 'events') => {
  const feature = await repo.get(storefrontFeature.id);
  if (!feature) throw new Error('feature vanished');
  return feature[pick].map((e) => String(e.id));
};

describe('entity CRUD round-trips', () => {
  it('adds, updates, and removes a resource', async () => {
    const { client, server, repo } = await setup();
    const added = parse<{ ok: boolean; id: string }>(
      await client.callTool({
        name: 'add_resource',
        arguments: {
          featureId: storefrontFeature.id,
          name: 'Orders DB',
          description: 'Primary order store.',
          kind: 'relational_db',
          provider: 'postgres',
          scope: 'local',
          sensitivity: 'public',
          accessMode: 'read',
          containsPii: false
        }
      })
    );
    expect(added.ok).toBe(true);
    expect(await names(repo, 'resources')).toContain(added.id);

    const updated = parse<{ ok: boolean }>(
      await client.callTool({
        name: 'update_resource',
        arguments: { featureId: storefrontFeature.id, resourceId: added.id, name: 'Orders DB v2' }
      })
    );
    expect(updated.ok).toBe(true);
    const feature = await repo.get(storefrontFeature.id);
    expect(feature?.resources.find((r) => String(r.id) === added.id)?.name).toBe('Orders DB v2');

    await client.callTool({
      name: 'remove_resource',
      arguments: { featureId: storefrontFeature.id, resourceId: added.id }
    });
    expect(await names(repo, 'resources')).not.toContain(added.id);
    await server.close();
  });

  it('adds, updates, and removes a persona', async () => {
    const { client, server, repo } = await setup();
    const added = parse<{ ok: boolean; id: string }>(
      await client.callTool({
        name: 'add_persona',
        arguments: {
          featureId: storefrontFeature.id,
          name: 'Returning Buyer',
          description: 'A signed-in shopper with items already in the cart.'
        }
      })
    );
    expect(added.ok).toBe(true);
    expect(await names(repo, 'personas')).toContain(added.id);

    const updated = parse<{ ok: boolean }>(
      await client.callTool({
        name: 'update_persona',
        arguments: { featureId: storefrontFeature.id, personaId: added.id, name: 'Loyal Buyer' }
      })
    );
    expect(updated.ok).toBe(true);
    const feature = await repo.get(storefrontFeature.id);
    expect(feature?.personas.find((p) => String(p.id) === added.id)?.name).toBe('Loyal Buyer');

    await client.callTool({
      name: 'remove_persona',
      arguments: { featureId: storefrontFeature.id, personaId: added.id }
    });
    expect(await names(repo, 'personas')).not.toContain(added.id);
    await server.close();
  });

  it('adds, updates, and removes an event', async () => {
    const { client, server, repo } = await setup();
    // The storefront emits 21 events with an empty registry (events:[]), which
    // is the opt-out state the validator tolerates. Declaring the first event
    // would opt the feature in and turn all 21 emitters into "unregistered"
    // errors — correct behavior, but not what this round-trip is exercising. So
    // run the event lifecycle against a fresh feature that emits nothing.
    const created = parse<{ id: string }>(
      await client.callTool({
        name: 'create_feature',
        arguments: { name: 'Events sandbox', description: 'A fresh feature for event round-trips.' }
      })
    );
    const fid = created.id as never;
    const eventIds = async () => {
      const feature = await repo.get(fid);
      if (!feature) throw new Error('feature vanished');
      return feature.events.map((e) => String(e.id));
    };

    const added = parse<{ ok: boolean; id: string }>(
      await client.callTool({
        name: 'add_event',
        arguments: {
          featureId: created.id,
          name: 'order.refunded',
          description: 'Emitted when an order is refunded.'
        }
      })
    );
    expect(added.ok).toBe(true);
    expect(await eventIds()).toContain(added.id);

    const updated = parse<{ ok: boolean }>(
      await client.callTool({
        name: 'update_event',
        arguments: {
          featureId: created.id,
          eventId: added.id,
          description: 'Emitted when an order is fully or partially refunded.'
        }
      })
    );
    expect(updated.ok).toBe(true);
    const feature = await repo.get(fid);
    expect(feature?.events.find((e) => String(e.id) === added.id)?.description).toContain('partially');

    await client.callTool({
      name: 'remove_event',
      arguments: { featureId: created.id, eventId: added.id }
    });
    expect(await eventIds()).not.toContain(added.id);
    await server.close();
  });
});
