import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fixedClock } from '../../src/shared/domain/Clock';
import { InMemoryFeatureRepository } from '../../src/features/behavior-model/infrastructure/persistence/InMemoryFeatureRepository';
import { storefrontFeature } from '../../src/features/behavior-model/infrastructure/seed/seedStorefront';
import { buildServer } from '../server';

/**
 * The loud-updates contract, end-to-end through the MCP envelope:
 *
 *  - `type:"list"` is an accepted synonym that lands as `array` (the effect
 *    names *_to_list made it the natural guess, and before the alias the
 *    bogus type slipped through the batch path and every downstream error
 *    blamed the value instead of the type).
 *  - an out-of-vocabulary type is refused AT WRITE TIME, naming the type.
 *  - an update op whose target id does not resolve is an ERROR, never a
 *    silent ok:true no-op.
 *  - update ops accept `patch:{...}` as well as flat fields, and an update
 *    that carries nothing to change is an error.
 *  - validation errors introduced by a remove op are attributed to that op.
 */

let nextId = 0;
const fixedIds = () => `loud-id-${nextId++}`;

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

const batch = async (
  client: Client,
  operations: readonly Record<string, unknown>[],
  extra: Record<string, unknown> = {}
) =>
  client.callTool({
    name: 'apply_batch',
    arguments: { featureId: String(storefrontFeature.id), operations, ...extra }
  });

describe('list type alias', () => {
  it('folds type:"list" to array on add_state_definition', async () => {
    const { client, repo } = await setup();
    const res = parse<{ ok: boolean }>(
      await batch(client, [
        {
          kind: 'add_state_definition',
          surfaceId: 'seed-shop-catalog',
          path: 'wishlist.items',
          type: 'list',
          defaultValue: [],
          description: 'Product ids the shopper saved for later.'
        }
      ])
    );
    expect(res.ok).toBe(true);
    const feature = await repo.get(storefrontFeature.id);
    const def = feature?.surfaces
      .find((s) => String(s.id) === 'seed-shop-catalog')
      ?.stateDefinitions.find((d) => String(d.path) === 'wishlist.items');
    expect(def?.type).toBe('array');
  });

  it('refuses an out-of-vocabulary type, naming the type and the array remedy', async () => {
    const { client } = await setup();
    const res = parse<{ ok: boolean; validation: { errors?: readonly string[] } }>(
      await batch(
        client,
        [
          {
            kind: 'add_state_definition',
            surfaceId: 'seed-shop-catalog',
            path: 'wishlist.items',
            type: 'banana',
            defaultValue: [],
            description: 'Product ids the shopper saved for later.'
          }
        ],
        { dryRun: true }
      )
    );
    expect(res.ok).toBe(false);
    const all = (res.validation.errors ?? []).join('\n');
    expect(all).toContain('unknown type "banana"');
    expect(all).toContain('array');
  });
});

describe('updates never no-op silently', () => {
  it('errors on update_persona with an unknown id instead of acking success', async () => {
    const { client } = await setup();
    const text = rawText(
      await batch(client, [
        { kind: 'update_persona', personaId: 'nope-123', name: 'Renamed' }
      ])
    );
    expect(text).toContain('not found');
    expect(text).not.toContain('"ok":true');
  });

  it('errors on a granular update_event with an unknown id', async () => {
    const { client } = await setup();
    const text = rawText(
      await client.callTool({
        name: 'update_event',
        arguments: {
          featureId: String(storefrontFeature.id),
          eventId: 'nope-123',
          description: 'New description.'
        }
      })
    );
    expect(text).toContain('not found');
  });

  it('hints at the surface level when update_action_rule targets a surface rule id', async () => {
    const { client } = await setup();
    const added = parse<{ ok: boolean; refs: Record<string, string> }>(
      await batch(client, [
        {
          kind: 'add_surface_rule',
          ref: 'r1',
          surfaceId: 'seed-shop-catalog',
          rule: {
            category: 'ux_feedback',
            effect: {
              type: 'show_message',
              message: 'Welcome to the catalog.',
              description: 'Greets the shopper on entry.'
            },
            description: 'Always greets the shopper.'
          }
        }
      ])
    );
    expect(added.ok).toBe(true);
    const text = rawText(
      await batch(client, [
        {
          kind: 'update_action_rule',
          surfaceId: 'seed-shop-catalog',
          actionId: 'seed-shop-cap-add-to-cart',
          ruleId: added.refs.r1,
          patch: { description: 'Updated.' }
        }
      ])
    );
    expect(text).toContain('SURFACE level');
    expect(text).toContain('update_surface_rule');
  });
});

describe('both patch spellings work, empty patches do not', () => {
  it('applies update_action fields nested under patch', async () => {
    const { client, repo } = await setup();
    const res = parse<{ ok: boolean }>(
      await batch(client, [
        {
          kind: 'update_action',
          surfaceId: 'seed-shop-catalog',
          actionId: 'seed-shop-cap-search',
          patch: { intent: 'Search the catalog fast.' }
        }
      ])
    );
    expect(res.ok).toBe(true);
    const feature = await repo.get(storefrontFeature.id);
    const action = feature?.surfaces
      .find((s) => String(s.id) === 'seed-shop-catalog')
      ?.actions.find((c) => String(c.id) === 'seed-shop-cap-search');
    expect(action?.intent).toBe('Search the catalog fast.');
  });

  it('errors on an update_action that carries nothing to change', async () => {
    const { client } = await setup();
    const text = rawText(
      await batch(client, [
        {
          kind: 'update_action',
          surfaceId: 'seed-shop-catalog',
          actionId: 'seed-shop-cap-search'
        }
      ])
    );
    expect(text).toContain('nothing to update');
  });
});

describe('library-ref ops carry definitionKind', () => {
  it('rejects link_project_definition without definitionKind, naming the fix', async () => {
    const { client } = await setup();
    const text = rawText(
      await batch(client, [
        { kind: 'link_project_definition', id: 'some-entity' }
      ])
    );
    expect(text).toContain('definitionKind');
  });
});

describe('remove ops own the errors they introduce', () => {
  it('attributes orphaned-reference errors to the remove_surface op', async () => {
    const { client } = await setup();
    const res = parse<{ ok: boolean; validation: { errors?: readonly string[] } }>(
      await batch(client, [{ kind: 'remove_surface', surfaceId: 'seed-shop-cart' }])
    );
    expect(res.ok).toBe(false);
    const all = (res.validation.errors ?? []).join('\n');
    expect(all).toContain('op[0] (remove_surface)');
  });
});
