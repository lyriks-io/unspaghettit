import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fixedClock } from '../../src/shared/domain/Clock';
import { InMemoryFeatureRepository } from '../../src/features/behavior-model/infrastructure/persistence/InMemoryFeatureRepository';
import { buildServer } from '../server';

// Criteria 3f9c8167 (feat-behavior-model), 9391bdc3 and d9212a83 (feat-mcp-authoring).

let nextId = 0;

const setup = async () => {
  nextId = 0;
  const repo = new InMemoryFeatureRepository();
  const server = buildServer(repo, {
    ids: () => `guid-${nextId++}`,
    clock: fixedClock('2026-11-05T00:00:00.000Z')
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server, repo };
};

const parse = (result: unknown): Record<string, unknown> => {
  const r = result as { content: readonly { type: string; text: string }[] };
  return JSON.parse(r.content[0]!.text) as Record<string, unknown>;
};

const errorText = (result: unknown): string => JSON.stringify(result);

/** A feature with a screen, a role nothing changes and an action kept for admins. */
const lockFeature = async (client: Client, extra: Record<string, unknown>[] = []) => {
  const created = parse(
    await client.callTool({
      name: 'create_feature',
      arguments: { name: 'Timesheets', description: 'Lock the timesheets of a period.' }
    })
  ) as { id: string };
  const result = await client.callTool({
    name: 'apply_batch',
    arguments: {
      featureId: created.id,
      operations: [
        { kind: 'add_surface', ref: 'screen', name: 'Timesheets', type: 'screen', description: 'The timesheets screen.' },
        {
          kind: 'add_state_definition',
          surfaceRef: 'screen',
          path: 'session.role',
          type: 'enum',
          enumValues: ['member', 'admin'],
          defaultValue: 'member',
          description: 'The role of the person signed in.'
        },
        {
          kind: 'add_state_definition',
          surfaceRef: 'screen',
          path: 'period.locked',
          type: 'boolean',
          defaultValue: false,
          description: 'Whether the period is locked.'
        },
        { kind: 'add_action', ref: 'lock', surfaceRef: 'screen', name: 'Lock period', intent: 'Lock the period.' },
        {
          kind: 'add_action_rule',
          ref: 'adminsOnly',
          surfaceRef: 'screen',
          actionRef: 'lock',
          rule: {
            category: 'permissions',
            condition: { left: 'session.role', operator: 'equals', right: 'member' },
            description: 'Members cannot lock a period.',
            effect: { type: 'block_action', reason: 'Only an admin locks a period.', description: 'Refuses members.' }
          }
        },
        {
          kind: 'add_effect',
          ref: 'locks',
          surfaceRef: 'screen',
          actionRef: 'lock',
          effect: { type: 'set_state', path: 'period.locked', value: true, description: 'The period is locked.' }
        },
        ...extra
      ]
    }
  });
  return { featureId: created.id, ack: parse(result) };
};

describe('apply_batch guidance', () => {
  it('warns when a guard reads a state nothing moves [criterion:3f9c8167]', async () => {
    const { client, server } = await setup();
    const { ack } = await lockFeature(client);
    expect(ack.ok).toBe(true);
    const warnings = (ack.warnings as string[] | undefined) ?? [];
    expect(warnings.some((w) => w.startsWith('Action "Lock period" is guarded on "session.role", which starts at "member"'))).toBe(true);
    await server.close();
  });

  it('says nothing once a persona starts with another role', async () => {
    const { client, server } = await setup();
    const { ack } = await lockFeature(client, [
      {
        kind: 'add_persona',
        name: 'Workspace Admin',
        description: 'An administrator of the workspace.',
        stateOverrides: [{ path: 'session.role', value: 'admin' }]
      }
    ]);
    expect(ack.ok).toBe(true);
    const warnings = (ack.warnings as string[] | undefined) ?? [];
    expect(warnings.some((w) => w.includes('"session.role"'))).toBe(false);
    await server.close();
  });

  it('reads a scenario nested under `scenario` like the flat form [criterion:9391bdc3]', async () => {
    const { client, server, repo } = await setup();
    const { featureId, ack } = await lockFeature(client);
    const refs = ack.refs as Record<string, string>;
    const nested = parse(
      await client.callTool({
        name: 'apply_batch',
        arguments: {
          featureId,
          operations: [
            {
              kind: 'add_scenario',
              scenario: {
                surfaceId: refs.screen,
                actionId: refs.lock,
                name: 'A member cannot lock',
                description: 'A member is refused.',
                expectedStatus: 'blocked'
              }
            }
          ]
        }
      })
    );
    expect(nested.ok).toBe(true);
    const feature = await repo.get(featureId as never);
    const scenarios = feature!.surfaces[0]!.actions[0]!.scenarios ?? [];
    expect(scenarios.map((s) => s.name)).toContain('A member cannot lock');
    await server.close();
  });

  it("refuses to edit a rule's effect through update_effect or remove_effect, naming the rule [criterion:d9212a83]", async () => {
    const { client, server, repo } = await setup();
    const { featureId, ack } = await lockFeature(client);
    const refs = ack.refs as Record<string, string>;
    const feature = await repo.get(featureId as never);
    const rule = feature!.surfaces[0]!.actions[0]!.rules[0]!;
    const ruleEffectId = String(rule.effect.id);
    const update = await client.callTool({
      name: 'apply_batch',
      arguments: {
        featureId,
        operations: [
          {
            kind: 'update_effect',
            surfaceId: refs.screen,
            actionId: refs.lock,
            effectId: ruleEffectId,
            patch: { reason: 'Admins only.' }
          }
        ]
      }
    });
    expect(errorText(update)).toContain('update_action_rule');
    expect(errorText(update)).toContain(String(rule.id));
    const remove = await client.callTool({
      name: 'apply_batch',
      arguments: {
        featureId,
        operations: [{ kind: 'remove_effect', surfaceId: refs.screen, actionId: refs.lock, effectId: ruleEffectId }]
      }
    });
    expect(errorText(remove)).toContain('remove_action_rule');
    // The rule's effect is still there: nothing reported success on it.
    const after = await repo.get(featureId as never);
    expect(String(after!.surfaces[0]!.actions[0]!.rules[0]!.effect.id)).toBe(ruleEffectId);
    // An id found nowhere stays an idempotent removal.
    const nowhere = parse(
      await client.callTool({
        name: 'apply_batch',
        arguments: {
          featureId,
          operations: [{ kind: 'remove_effect', surfaceId: refs.screen, actionId: refs.lock, effectId: 'nope' }]
        }
      })
    );
    expect(nowhere.ok).toBe(true);
    await server.close();
  });
});
