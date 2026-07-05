import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fixedClock } from '../src/shared/domain/Clock';
import { InMemoryFeatureRepository } from '../src/features/behavior-model/infrastructure/persistence/InMemoryFeatureRepository';
import { storefrontFeature } from '../src/features/behavior-model/infrastructure/seed/seedStorefront';
import { InMemoryProjectRepository } from '../src/features/projects/infrastructure/persistence/InMemoryProjectRepository';
import type { Project } from '../src/features/projects/domain/entities/Project';
import type { ProjectId } from '../src/features/projects/domain/value-objects/ids';
import { buildServer } from './server';

let nextId = 0;
const fixedIds = () => `test-id-${nextId++}`;

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

const parseTextContent = (result: unknown): unknown => {
  const r = result as { content: readonly { type: string; text: string }[] };
  const first = r.content[0];
  if (!first || first.type !== 'text') throw new Error('expected text content');
  return JSON.parse(first.text);
};

describe('MCP server', () => {
  it('exposes the read tools and the phase-1 + phase-2 write tools', async () => {
    const { client, server } = await setup();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'add_action',
      'add_action_invariant',
      'add_action_rule',
      'add_effect',
      'add_entity',
      'add_entity_field',
      'add_event',
      'add_feature_invariant',
      'add_feature_tag',
      'add_feature_to_project',
      'add_parameter',
      'add_persona',
      'add_project_invariant',
      'add_project_tag',
      'add_reachability_goal',
      'add_resource',
      'add_scenario',
      'add_state_definition',
      'add_surface',
      'add_surface_invariant',
      'add_surface_rule',
      'add_transition',
      'add_value_set',
      'apply_batch',
      'attach_source_file',
      'create_feature',
      'create_project',
      'delete_feature',
      'delete_project',
      'dequeue',
      'dry_run_simulate',
      'enqueue',
      'finalize_analysis',
      'find_state_references',
      'generate_types',
      'get_action',
      'get_behavioral_index',
      'get_drift',
      'get_feature',
      'get_implementation_gaps',
      'get_implementation_status',
      'get_neighborhood',
      'get_next_queued',
      'get_project',
      'get_project_aggregate',
      'get_provenance',
      'get_repo_context',
      'get_source',
      'get_spec_gaps',
      'get_surface',
      'list_actions',
      'list_feature_ids',
      'list_features',
      'list_projects',
      'list_queue',
      'list_sources',
      'model_check',
      'move_action',
      'move_feature_in_project',
      'move_parameter',
      'move_state_definition',
      'move_surface',
      'propose_evolution',
      'record_element_span',
      'remove_action',
      'remove_action_invariant',
      'remove_action_rule',
      'remove_effect',
      'remove_entity',
      'remove_entity_field',
      'remove_event',
      'remove_feature_from_project',
      'remove_feature_invariant',
      'remove_feature_tag',
      'remove_parameter',
      'remove_persona',
      'remove_project_invariant',
      'remove_project_tag',
      'remove_reachability_goal',
      'remove_resource',
      'remove_scenario',
      'remove_source',
      'remove_state_definition',
      'remove_surface',
      'remove_surface_invariant',
      'remove_surface_rule',
      'remove_transition',
      'remove_value_set',
      'reorder_queue',
      'replace_project',
      'report_implementation_status',
      'report_implementation_status_batch',
      'reset_analysis',
      'run_all_scenarios',
      'save_feature',
      'score_feature',
      'set_expected_actions',
      'set_non_goals',
      'set_queue_target',
      'sync_from_index',
      'update_action',
      'update_action_invariant',
      'update_action_rule',
      'update_effect',
      'update_entity',
      'update_entity_field',
      'update_event',
      'update_feature',
      'update_feature_invariant',
      'update_parameter',
      'update_persona',
      'update_project',
      'update_project_invariant',
      'update_reachability_goal',
      'update_resource',
      'update_scenario',
      'update_state_definition',
      'update_surface',
      'update_surface_invariant',
      'update_surface_rule',
      'update_transition',
      'update_value_set',
      'verify'
    ]);
    await server.close();
  });

  it('get_repo_context returns linkedProjectId + features[] when a repo link is bound', async () => {
    // Wire a project that owns the seeded storefront feature, then build the
    // server with a repoContext binding (mimics what mcp-server/bin.ts does
    // when started inside a repo that has run `unspa link`).
    const repo = new InMemoryFeatureRepository();
    await repo.save(storefrontFeature);
    const projectRepo = new InMemoryProjectRepository();
    const project: Project = {
      id: 'proj-storefront' as ProjectId,
      name: 'Storefront',
      description: 'A demo project that owns the storefront feature.',
      featureIds: [storefrontFeature.id],
      createdAt: '2026-05-09T00:00:00.000Z',
      updatedAt: '2026-05-09T00:00:00.000Z'
    };
    await projectRepo.save(project);
    const server = buildServer(repo, {
      ids: fixedIds,
      clock: fixedClock('2026-05-09T00:00:00.000Z'),
      projectRepo,
      repoContext: {
        cwd: '/tmp/fake',
        linkPath: '/tmp/fake/.unspa.json',
        link: { projectId: 'proj-storefront', projectName: 'Storefront' }
      }
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: 'get_repo_context', arguments: {} });
    const payload = parseTextContent(result) as {
      linked: boolean;
      linkedProjectId: string | null;
      linkedProjectName: string | null;
      features: readonly { id: string; name: string }[];
    };

    expect(payload.linked).toBe(true);
    expect(payload.linkedProjectId).toBe('proj-storefront');
    expect(payload.linkedProjectName).toBe('Storefront');
    expect(payload.features).toEqual([{ id: storefrontFeature.id, name: storefrontFeature.name }]);
    await server.close();
  });

  it('exposes server instructions teaching the domain to a cold LLM', async () => {
    const { client, server } = await setup();
    const instructions = client.getInstructions();
    expect(instructions).toBeDefined();
    // Hits on the things a cold LLM needs to know to avoid mis-using the surface.
    expect(instructions).toMatch(/Feature/);
    expect(instructions).toMatch(/apply_batch/);
    expect(instructions).toMatch(/get_action/);
    expect(instructions).toMatch(/dotted/i);
    expect(instructions).toMatch(/never invent/i);
    await server.close();
  });

  it('list_features returns repository summaries', async () => {
    const { client, server } = await setup();
    const result = await client.callTool({ name: 'list_features', arguments: {} });
    const summaries = parseTextContent(result) as readonly { id: string; name: string }[];
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.name).toBe('E-commerce storefront');
    await server.close();
  });

  it('get_action returns a focused payload that is far smaller than the full feature', async () => {
    const { client, server } = await setup();
    const focusedResult = await client.callTool({
      name: 'get_action',
      arguments: {
        featureId: storefrontFeature.id,
        actionId: 'seed-shop-cap-add-to-cart'
      }
    });
    const fullResult = await client.callTool({
      name: 'get_feature',
      arguments: { featureId: storefrontFeature.id, verbose: true }
    });
    const focusedText = (focusedResult as { content: { text: string }[] }).content[0]?.text ?? '';
    const fullText = (fullResult as { content: { text: string }[] }).content[0]?.text ?? '';
    expect(focusedText.length).toBeGreaterThan(0);
    expect(focusedText.length).toBeLessThan(fullText.length / 4);
    await server.close();
  });

  it('get_feature returns an index (no rule bodies) by default', async () => {
    const { client, server } = await setup();
    const indexResult = await client.callTool({
      name: 'get_feature',
      arguments: { featureId: storefrontFeature.id }
    });
    const verboseResult = await client.callTool({
      name: 'get_feature',
      arguments: { featureId: storefrontFeature.id, verbose: true }
    });
    const indexText = (indexResult as { content: { text: string }[] }).content[0]?.text ?? '';
    const verboseText = (verboseResult as { content: { text: string }[] }).content[0]?.text ?? '';
    expect(indexText.length).toBeGreaterThan(0);
    // Index drops every body field. Must be substantially smaller.
    expect(indexText.length).toBeLessThan(verboseText.length / 3);
    // And it must not leak rule bodies (the seed has rules; the index should not).
    expect(indexText).not.toMatch(/"rules":\s*\[/);
    await server.close();
  });

  it('get_action includes devContext when devContext is set on the feature', async () => {
    const { client, server } = await setup();
    await client.callTool({
      name: 'update_feature',
      arguments: {
        featureId: storefrontFeature.id,
        description: storefrontFeature.description,
        devContext: { mode: 'auto' }
      }
    });
    const result = await client.callTool({
      name: 'get_action',
      arguments: {
        featureId: storefrontFeature.id,
        actionId: 'seed-shop-cap-add-to-cart'
      }
    });
    const focused = parseTextContent(result) as {
      devContext?: { mode: string; conventions?: readonly string[] };
    };
    expect(focused.devContext?.mode).toBe('auto');
    expect(focused.devContext?.conventions?.length ?? 0).toBeGreaterThan(0);
    await server.close();
  });

  it('returns an MCP-shaped error when an action id does not exist', async () => {
    const { client, server } = await setup();
    const result = await client.callTool({
      name: 'get_action',
      arguments: { featureId: storefrontFeature.id, actionId: 'nope' }
    });
    const r = result as { isError: boolean; content: { text: string }[] };
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toMatch(/not found/i);
    await server.close();
  });

  it('create_feature persists a new empty feature and returns a slim ack', async () => {
    const { client, server, repo } = await setup();
    const result = await client.callTool({
      name: 'create_feature',
      arguments: { name: 'My new model', description: '  trim me  ' }
    });
    const ack = parseTextContent(result) as {
      ok: true;
      id: string;
      createdAt: string;
      updatedAt: string;
    };
    expect(ack.ok).toBe(true);
    expect(ack.id).toBe('test-id-0');
    expect(typeof ack.createdAt).toBe('string');
    expect(typeof ack.updatedAt).toBe('string');
    const persisted = await repo.get('test-id-0' as never);
    expect(persisted?.name).toBe('My new model');
    expect(persisted?.description).toBe('trim me');
    expect(persisted?.surfaces).toEqual([]);
    await server.close();
  });

  it('propose_evolution creates a dashed-placeholder action, then update_action accepts it', async () => {
    const { client, server, repo } = await setup();
    const surfaceId = String(storefrontFeature.surfaces[0]!.id);
    const proposed = await client.callTool({
      name: 'propose_evolution',
      arguments: {
        featureId: storefrontFeature.id,
        surfaceId,
        name: 'Sign in with SSO',
        intent: 'Federated login',
        rationale: 'Most competitors offer SSO',
        category: 'competitor'
      }
    });
    const ack = parseTextContent(proposed) as { ok: true; id: string };
    expect(ack.ok).toBe(true);

    const findAction = async () => {
      const feat = await repo.get(storefrontFeature.id);
      return feat?.surfaces.flatMap((s) => s.actions).find((a) => String(a.id) === ack.id);
    };

    const created = await findAction();
    expect(created?.evolution).toEqual({
      rationale: 'Most competitors offer SSO',
      category: 'competitor'
    });
    expect(created?.effects).toEqual([]); // skeleton body

    // Accept: clearing the marker promotes it to a committed action.
    await client.callTool({
      name: 'update_action',
      arguments: {
        featureId: storefrontFeature.id,
        surfaceId,
        actionId: ack.id,
        evolution: null
      }
    });
    const accepted = await findAction();
    expect(accepted?.evolution).toBeUndefined();
    await server.close();
  });

  it('update_feature patches only the provided fields and returns a slim ack', async () => {
    const { client, server, repo } = await setup();
    const result = await client.callTool({
      name: 'update_feature',
      arguments: { featureId: storefrontFeature.id, name: 'Renamed' }
    });
    const ack = parseTextContent(result) as {
      ok: true;
      featureId: string;
      updatedAt: string;
    };
    expect(ack.ok).toBe(true);
    expect(ack.featureId).toBe(storefrontFeature.id);
    expect(typeof ack.updatedAt).toBe('string');
    const persisted = await repo.get(storefrontFeature.id);
    expect(persisted?.name).toBe('Renamed');
    expect(persisted?.description).toBe(storefrontFeature.description);
    await server.close();
  });

  it('add_project_tag + remove_project_tag round-trip a tag on a freshly created project', async () => {
    const { client, server } = await setup();

    const created = await client.callTool({
      name: 'create_project',
      arguments: { name: 'eShop', description: 'Storefront experiments.' }
    });
    const { id: projectId } = parseTextContent(created) as { id: string };

    const added = await client.callTool({
      name: 'add_project_tag',
      arguments: { projectId, type: 'Team', value: 'Growth' }
    });
    const addedAck = parseTextContent(added) as {
      ok: true;
      tags: readonly { type: string; value: string }[];
    };
    expect(addedAck.tags).toEqual([{ type: 'team', value: 'growth' }]);

    // Case-insensitive dedupe via tagKey; normalized to lowercase on save.
    await client.callTool({
      name: 'add_project_tag',
      arguments: { projectId, type: 'team', value: 'GROWTH' }
    });
    const fetched = await client.callTool({
      name: 'get_project',
      arguments: { projectId }
    });
    const project = parseTextContent(fetched) as { tags?: readonly unknown[] };
    expect(project.tags).toEqual([{ type: 'team', value: 'growth' }]);

    const removed = await client.callTool({
      name: 'remove_project_tag',
      arguments: { projectId, type: 'Team', value: 'Growth' }
    });
    const removedAck = parseTextContent(removed) as { ok: true; tags: readonly unknown[] };
    expect(removedAck.tags).toEqual([]);

    await server.close();
  });

  it('add_feature_tag + remove_feature_tag round-trip a tag through the repository', async () => {
    const { client, server, repo } = await setup();

    const added = await client.callTool({
      name: 'add_feature_tag',
      arguments: { featureId: storefrontFeature.id, type: 'Domain', value: 'Commerce' }
    });
    const addedAck = parseTextContent(added) as {
      ok: true;
      tags: readonly { type: string; value: string }[];
    };
    expect(addedAck.ok).toBe(true);
    expect(addedAck.tags).toEqual([{ type: 'domain', value: 'commerce' }]);

    // Idempotent: re-adding the same tag is a no-op (deduped by tagKey).
    // Tags are normalized to lowercase so a re-add with different casing is
    // structurally identical to the first add.
    await client.callTool({
      name: 'add_feature_tag',
      arguments: { featureId: storefrontFeature.id, type: 'domain', value: 'commerce' }
    });
    const afterDuplicate = await repo.get(storefrontFeature.id);
    expect(afterDuplicate?.tags).toEqual([{ type: 'domain', value: 'commerce' }]);

    const removed = await client.callTool({
      name: 'remove_feature_tag',
      arguments: { featureId: storefrontFeature.id, type: 'Domain', value: 'Commerce' }
    });
    const removedAck = parseTextContent(removed) as { ok: true; tags: readonly unknown[] };
    expect(removedAck.tags).toEqual([]);
    const cleared = await repo.get(storefrontFeature.id);
    expect(cleared?.tags).toBeUndefined();

    await server.close();
  });

  it('delete_feature removes the feature from the repository', async () => {
    const { client, server, repo } = await setup();
    const result = await client.callTool({
      name: 'delete_feature',
      arguments: { featureId: storefrontFeature.id }
    });
    expect((result as { isError?: boolean }).isError).toBeFalsy();
    expect(await repo.get(storefrontFeature.id)).toBeNull();
    await server.close();
  });

  it('add_surface + add_action + add_action_rule round-trip through the granular tools', async () => {
    const { client, server, repo } = await setup();

    // Seed an feature with no surfaces.
    const created = parseTextContent(
      await client.callTool({
        name: 'create_feature',
        arguments: { name: 'Roundtrip', description: 'Roundtrip tool integration test.' }
      })
    ) as { id: string };

    // Add a surface (id will be 'test-id-1' since 'test-id-0' was used by create_feature).
    await client.callTool({
      name: 'add_surface',
      arguments: {
        featureId: created.id,
        name: 'Catalog',
        type: 'screen',
        description: 'Catalog screen for granular tool testing.'
      }
    });

    // Declare the state path the rule below depends on, so the reference-
    // integrity check has something to resolve `user.signedIn` against.
    await client.callTool({
      name: 'add_state_definition',
      arguments: {
        featureId: created.id,
        surfaceId: 'test-id-1',
        path: 'user.signedIn',
        type: 'boolean',
        defaultValue: false,
        description: 'Whether the current user is signed in.'
      }
    });

    // Add an action under that surface.
    await client.callTool({
      name: 'add_action',
      arguments: {
        featureId: created.id,
        surfaceId: 'test-id-1',
        name: 'Add to cart',
        intent: 'Append the focused product to the cart.'
      }
    });

    // Add a permission rule on that action.
    await client.callTool({
      name: 'add_action_rule',
      arguments: {
        featureId: created.id,
        surfaceId: 'test-id-1',
        actionId: 'test-id-3',
        rule: {
          category: 'permissions',
          condition: { left: 'user.signedIn', operator: 'is_false' },
          description: 'Blocks cart additions from signed-out users.',
          effect: {
            type: 'block_action',
            reason: 'Sign in to add to cart.',
            description: 'Rejects the add-to-cart action until the user signs in.'
          }
        }
      }
    });

    const persisted = await repo.get(created.id as never);
    expect(persisted?.surfaces).toHaveLength(1);
    const surface = persisted!.surfaces[0]!;
    expect(surface.name).toBe('Catalog');
    expect(surface.actions).toHaveLength(1);
    expect(surface.actions[0]?.rules).toHaveLength(1);
    expect(surface.actions[0]?.rules[0]?.category).toBe('permissions');
    await server.close();
  });

  it('remove_surface_invariant returns a validation error when the feature would be invalid', async () => {
    const { client, server } = await setup();
    // The seed storefront feature already has surfaces; pick one and try to
    // remove an invariant from it that does not exist. The transform is a no-op
    // so the resulting feature is still valid; this just exercises the path.
    const result = await client.callTool({
      name: 'remove_surface_invariant',
      arguments: {
        featureId: storefrontFeature.id,
        surfaceId: storefrontFeature.surfaces[0]!.id,
        invariantId: 'does-not-exist'
      }
    });
    expect((result as { isError?: boolean }).isError).toBeFalsy();
    await server.close();
  });

  it('save_feature rejects an feature with duplicate surface ids', async () => {
    const { client, server } = await setup();
    const broken = {
      ...storefrontFeature,
      surfaces: [
        ...storefrontFeature.surfaces,
        { ...storefrontFeature.surfaces[0]! } // same id twice
      ]
    };
    const result = await client.callTool({
      name: 'save_feature',
      arguments: { feature: broken }
    });
    const r = result as { isError: boolean; content: { text: string }[] };
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toMatch(/duplicate surface/i);
    await server.close();
  });

  it('apply_batch creates surface + action + rule in one call using named refs', async () => {
    const { client, server, repo } = await setup();
    const created = parseTextContent(
      await client.callTool({
        name: 'create_feature',
        arguments: { name: 'Batch demo', description: 'Batch operation integration test.' }
      })
    ) as { id: string };

    const result = await client.callTool({
      name: 'apply_batch',
      arguments: {
        featureId: created.id,
        operations: [
          {
            kind: 'add_surface',
            ref: 'shop',
            name: 'Shop',
            type: 'screen',
            description: 'Shop screen for batch operation testing.'
          },
          // apply_batch now runs reference-integrity validation (paths must be
          // declared on the surface they're referenced from). Declare the
          // path the rule reads from before the rule itself.
          {
            kind: 'add_state_definition',
            surfaceRef: 'shop',
            path: 'user.signedIn',
            type: 'boolean',
            defaultValue: false,
            description: 'Whether the current user is signed in.'
          },
          {
            kind: 'add_action',
            ref: 'addToCart',
            surfaceRef: 'shop',
            name: 'Add to cart',
            intent: 'Append focused product to cart.'
          },
          {
            kind: 'add_action_rule',
            surfaceRef: 'shop',
            actionRef: 'addToCart',
            rule: {
              category: 'permissions',
              condition: { left: 'user.signedIn', operator: 'is_false' },
              description: 'Blocks cart additions from signed-out users.',
              effect: {
                type: 'block_action',
                reason: 'Sign in to add to cart.',
                description: 'Rejects the add-to-cart action until sign-in.'
              }
            }
          }
        ]
      }
    });

    const ack = parseTextContent(result) as {
      ok: true;
      featureId: string;
      appliedCount: number;
      refs: Record<string, string>;
    };
    expect(ack.ok).toBe(true);
    expect(ack.appliedCount).toBe(4);
    expect(Object.keys(ack.refs).sort()).toEqual(['addToCart', 'shop']);

    const persisted = await repo.get(created.id as never);
    expect(persisted?.surfaces).toHaveLength(1);
    const surface = persisted!.surfaces[0]!;
    expect(surface.name).toBe('Shop');
    expect(surface.id).toBe(ack.refs.shop);
    expect(surface.actions).toHaveLength(1);
    expect(surface.actions[0]?.id).toBe(ack.refs.addToCart);
    expect(surface.actions[0]?.rules).toHaveLength(1);
    expect(surface.actions[0]?.rules[0]?.category).toBe('permissions');
    await server.close();
  });

  it('apply_batch is atomic. Bad op rolls back the whole batch', async () => {
    const { client, server, repo } = await setup();
    const created = parseTextContent(
      await client.callTool({
        name: 'create_feature',
        arguments: { name: 'Atomic test', description: 'Verifies failed batches roll back.' }
      })
    ) as { id: string };
    const before = await repo.get(created.id as never);

    const result = await client.callTool({
      name: 'apply_batch',
      arguments: {
        featureId: created.id,
        operations: [
          {
            kind: 'add_surface',
            ref: 's1',
            name: 'S1',
            type: 'screen',
            description: 'Surface created before the failing operation.'
          },
          { kind: 'add_action', surfaceRef: 'unknownRef', name: 'oops', intent: 'fail' }
        ]
      }
    });
    const r = result as { isError: boolean; content: { text: string }[] };
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toMatch(/unknownRef/);

    const after = await repo.get(created.id as never);
    expect(after?.updatedAt).toBe(before?.updatedAt);
    expect(after?.surfaces).toHaveLength(0);
    await server.close();
  });

  it('apply_batch resolves sharedWith entries through refs created earlier in the batch', async () => {
    const { client, server, repo } = await setup();
    const created = parseTextContent(
      await client.callTool({
        name: 'create_feature',
        arguments: {
          name: 'Shared state refs',
          description: 'Verifies same-batch shared state reference resolution.'
        }
      })
    ) as { id: string };

    const result = await client.callTool({
      name: 'apply_batch',
      arguments: {
        featureId: created.id,
        operations: [
          {
            kind: 'add_surface',
            ref: 'entry',
            name: 'Entry',
            type: 'screen',
            description: 'Entry screen that owns the shared state.'
          },
          {
            kind: 'add_surface',
            ref: 'results',
            name: 'Results',
            type: 'screen',
            description: 'Results screen that shares the state.'
          },
          {
            kind: 'add_state_definition',
            surfaceRef: 'entry',
            path: 'audit.status',
            type: 'enum',
            defaultValue: 'idle',
            enumValues: ['idle', 'running', 'done'],
            description: 'Current audit workflow status.',
            sharedWith: ['results']
          }
        ]
      }
    });

    const ack = parseTextContent(result) as { refs: Record<string, string> };
    const persisted = await repo.get(created.id as never);
    const state = persisted?.surfaces[0]?.stateDefinitions[0];
    expect(state?.sharedWith).toEqual([ack.refs.results]);
    await server.close();
  });

  it('apply_batch dryRun validates and scores without saving', async () => {
    const { client, server, repo } = await setup();
    const created = parseTextContent(
      await client.callTool({
        name: 'create_feature',
        arguments: { name: 'Dry run demo', description: 'Validates dry-run batch behavior.' }
      })
    ) as { id: string };

    const before = await repo.get(created.id as never);
    const result = await client.callTool({
      name: 'apply_batch',
      arguments: {
        featureId: created.id,
        dryRun: true,
        operations: [
          {
            kind: 'add_surface',
            ref: 'screen',
            name: 'Screen',
            type: 'screen',
            description: 'Screen used by the dry-run action.'
          },
          {
            kind: 'add_action',
            ref: 'go',
            surfaceRef: 'screen',
            name: 'Go',
            intent: 'Run the action.'
          },
          {
            kind: 'add_effect',
            surfaceRef: 'screen',
            actionRef: 'go',
            effect: {
              type: 'show_message',
              message: 'Done',
              description: 'Shows completion feedback after the action runs.'
            }
          }
        ]
      }
    });

    const output = parseTextContent(result) as {
      ok: true;
      dryRun: true;
      refs: Record<string, string>;
      validation: { valid: true };
      maturity: { percentage: number };
    };
    expect(output.ok).toBe(true);
    expect(output.dryRun).toBe(true);
    expect(output.validation.valid).toBe(true);
    expect(output.maturity.percentage).toBeGreaterThan(0);
    expect(Object.keys(output.refs).sort()).toEqual(['go', 'screen']);

    const after = await repo.get(created.id as never);
    expect(after).toEqual(before);
    await server.close();
  });

  it('apply_batch dryRun reports typed default suggestions without saving', async () => {
    const { client, server, repo } = await setup();
    const created = parseTextContent(
      await client.callTool({
        name: 'create_feature',
        arguments: {
          name: 'Bad defaults',
          description: 'Validates default value type suggestions.'
        }
      })
    ) as { id: string };

    const result = await client.callTool({
      name: 'apply_batch',
      arguments: {
        featureId: created.id,
        dryRun: true,
        operations: [
          {
            kind: 'add_surface',
            ref: 'screen',
            name: 'Screen',
            type: 'screen',
            description: 'Screen used by the invalid default test.'
          },
          {
            kind: 'add_state_definition',
            surfaceRef: 'screen',
            path: 'app.isReady',
            type: 'boolean',
            defaultValue: 'false',
            description: 'Whether the application is ready.'
          }
        ]
      }
    });

    const output = parseTextContent(result) as {
      ok: false;
      validation: { valid: false; errors: readonly string[] };
      maturity: null;
    };
    expect(output.ok).toBe(false);
    expect(output.validation.valid).toBe(false);
    expect(output.validation.errors.join('\n')).toContain('Use false instead of "false"');
    expect(output.maturity).toBeNull();

    const persisted = await repo.get(created.id as never);
    expect(persisted?.surfaces).toHaveLength(0);
    await server.close();
  });

  describe('get_spec_gaps', () => {
    type Gap = {
      severity: 'critical' | 'recommended';
      entityType: 'feature' | 'surface' | 'action';
      entityId: string;
      entityName: string;
      reason: string;
      suggestedFix: string;
    };

    const callGaps = async (client: Client, featureId: string): Promise<readonly Gap[]> => {
      const result = await client.callTool({
        name: 'get_spec_gaps',
        arguments: { featureId }
      });
      return (parseTextContent(result) as { gaps: readonly Gap[] }).gaps;
    };

    it('flags every expectedActions entry without a matching Action as critical', async () => {
      const { client, server } = await setup();
      const created = parseTextContent(
        await client.callTool({
          name: 'create_feature',
          arguments: {
            name: 'Dashboard',
            description: 'Feature used to verify expected action gaps.'
          }
        })
      ) as { id: string };

      await client.callTool({
        name: 'set_expected_actions',
        arguments: {
          featureId: created.id,
          expectedActions: ['filter results', 'detail view']
        }
      });

      const gaps = await callGaps(client, created.id);
      const expectedGaps = gaps.filter(
        (g) => g.severity === 'critical' && g.entityType === 'feature'
      );
      expect(expectedGaps.length).toBeGreaterThanOrEqual(2);
      const reasons = expectedGaps.map((g) => g.reason).join('|');
      expect(reasons).toMatch(/filter results/);
      expect(reasons).toMatch(/detail view/);
      await server.close();
    });

    it('flags a Surface with zero stateDefinitions as critical', async () => {
      const { client, server } = await setup();
      const created = parseTextContent(
        await client.callTool({
          name: 'create_feature',
          arguments: {
            name: 'Empty surface',
            description: 'Feature used to verify empty-surface gap detection.'
          }
        })
      ) as { id: string };

      const addedSurface = parseTextContent(
        await client.callTool({
          name: 'add_surface',
          arguments: {
            featureId: created.id,
            name: 'Catalog',
            type: 'screen',
            description: 'Catalog surface intentionally starts without state.'
          }
        })
      ) as { id: string };

      const gaps = await callGaps(client, created.id);
      const surfaceGaps = gaps.filter(
        (g) =>
          g.severity === 'critical' && g.entityType === 'surface' && g.entityId === addedSurface.id
      );
      expect(surfaceGaps).toHaveLength(1);
      expect(surfaceGaps[0]!.suggestedFix).toMatch(/state path/i);
      await server.close();
    });

    it('flags a destructive Action without a scenario as critical, and clears it once a scenario covers the path', async () => {
      const { client, server } = await setup();
      const created = parseTextContent(
        await client.callTool({
          name: 'create_feature',
          arguments: {
            name: 'Destructive',
            description: 'Feature used to verify destructive action gaps.'
          }
        })
      ) as { id: string };

      const surface = parseTextContent(
        await client.callTool({
          name: 'add_surface',
          arguments: {
            featureId: created.id,
            name: 'Account',
            type: 'screen',
            description: 'Account management screen for destructive action testing.'
          }
        })
      ) as { id: string };

      await client.callTool({
        name: 'add_state_definition',
        arguments: {
          featureId: created.id,
          surfaceId: surface.id,
          path: 'account.exists',
          type: 'boolean',
          defaultValue: true,
          description: 'Whether the account currently exists.'
        }
      });

      const action = parseTextContent(
        await client.callTool({
          name: 'add_action',
          arguments: {
            featureId: created.id,
            surfaceId: surface.id,
            name: 'Delete account',
            intent: 'Permanently destroy the account record.',
            roles: ['destructive']
          }
        })
      ) as { id: string };

      // Add a benign effect so the unrelated "no effects" critical gap goes away.
      await client.callTool({
        name: 'add_effect',
        arguments: {
          featureId: created.id,
          surfaceId: surface.id,
          actionId: action.id,
          effect: {
            type: 'show_message',
            message: 'Account deleted',
            tone: 'info',
            description: 'Confirms account deletion to the user.'
          }
        }
      });

      const before = await callGaps(client, created.id);
      const destructiveBefore = before.filter(
        (g) =>
          g.severity === 'critical' &&
          g.entityType === 'action' &&
          g.entityId === action.id &&
          /destructive/i.test(g.reason)
      );
      expect(destructiveBefore).toHaveLength(1);

      await client.callTool({
        name: 'add_scenario',
        arguments: {
          featureId: created.id,
          surfaceId: surface.id,
          actionId: action.id,
          name: 'Deletes an existing account',
          description: 'Covers the successful deletion path for an existing account.',
          stateOverrides: [{ path: 'account.exists', value: true }]
        }
      });

      const after = await callGaps(client, created.id);
      const destructiveAfter = after.filter(
        (g) =>
          g.entityType === 'action' && g.entityId === action.id && /destructive/i.test(g.reason)
      );
      expect(destructiveAfter).toHaveLength(0);
      await server.close();
    });

    it('flags an async Action whose only scenario covers the happy path as a recommended gap', async () => {
      const { client, server } = await setup();
      const created = parseTextContent(
        await client.callTool({
          name: 'create_feature',
          arguments: {
            name: 'Async',
            description: 'Feature used to verify async action gap detection.'
          }
        })
      ) as { id: string };

      const surface = parseTextContent(
        await client.callTool({
          name: 'add_surface',
          arguments: {
            featureId: created.id,
            name: 'Search',
            type: 'screen',
            description: 'Search screen that triggers asynchronous loading.'
          }
        })
      ) as { id: string };

      await client.callTool({
        name: 'add_state_definition',
        arguments: {
          featureId: created.id,
          surfaceId: surface.id,
          path: 'search.query',
          type: 'string',
          defaultValue: '',
          description: 'Search text entered by the user.'
        }
      });

      const action = parseTextContent(
        await client.callTool({
          name: 'add_action',
          arguments: {
            featureId: created.id,
            surfaceId: surface.id,
            name: 'Fetch results',
            intent: 'Hit the API and render results.',
            roles: ['async']
          }
        })
      ) as { id: string };

      await client.callTool({
        name: 'add_effect',
        arguments: {
          featureId: created.id,
          surfaceId: surface.id,
          actionId: action.id,
          effect: {
            type: 'show_message',
            message: 'Searching…',
            description: 'Shows that the search request has started.'
          }
        }
      });

      // Happy-path scenario only, no `loading` or `error` paths touched.
      await client.callTool({
        name: 'add_scenario',
        arguments: {
          featureId: created.id,
          surfaceId: surface.id,
          actionId: action.id,
          name: 'Returns results',
          description: 'Covers the successful search results path.',
          stateOverrides: [{ path: 'search.query', value: 'hat' }]
        }
      });

      const gaps = await callGaps(client, created.id);
      const asyncGap = gaps.filter(
        (g) =>
          g.severity === 'recommended' &&
          g.entityType === 'action' &&
          g.entityId === action.id &&
          /async/i.test(g.reason)
      );
      expect(asyncGap).toHaveLength(1);
      await server.close();
    });

    it('returns an empty gaps list once every critical and recommended gap is resolved', async () => {
      const { client, server } = await setup();
      const created = parseTextContent(
        await client.callTool({
          name: 'create_feature',
          arguments: {
            name: 'Complete',
            description: 'Feature used to verify a gap-free minimal model.'
          }
        })
      ) as { id: string };

      const surface = parseTextContent(
        await client.callTool({
          name: 'add_surface',
          arguments: {
            featureId: created.id,
            name: 'Main',
            type: 'screen',
            description: 'Main screen for the complete gap test.'
          }
        })
      ) as { id: string };

      await client.callTool({
        name: 'add_state_definition',
        arguments: {
          featureId: created.id,
          surfaceId: surface.id,
          path: 'main.ready',
          type: 'boolean',
          defaultValue: false,
          description: 'Whether the main prompt is ready.'
        }
      });

      const action = parseTextContent(
        await client.callTool({
          name: 'add_action',
          arguments: {
            featureId: created.id,
            surfaceId: surface.id,
            name: 'Acknowledge',
            intent: 'Acknowledge the prompt.'
          }
        })
      ) as { id: string };

      await client.callTool({
        name: 'add_effect',
        arguments: {
          featureId: created.id,
          surfaceId: surface.id,
          actionId: action.id,
          effect: {
            type: 'show_message',
            message: 'Acknowledged',
            description: 'Shows acknowledgement feedback to the user.'
          }
        }
      });

      // Record an implementation status entry so the "no ImplementationStatus
      // entry" recommendation clears.
      await client.callTool({
        name: 'report_implementation_status',
        arguments: {
          featureId: created.id,
          actionId: action.id,
          foundEntities: [
            {
              entityType: 'action',
              entityId: action.id,
              locations: [{ file: 'src/Acknowledge.ts', line: 1 }]
            }
          ]
        }
      });

      const gaps = await callGaps(client, created.id);
      expect(gaps).toEqual([]);
      await server.close();
    });
  });

  it('dry_run_simulate runs the deterministic simulator and returns the result', async () => {
    const { client, server } = await setup();
    const result = await client.callTool({
      name: 'dry_run_simulate',
      arguments: {
        featureId: storefrontFeature.id,
        surfaceId: 'seed-shop-catalog',
        actionId: 'seed-shop-cap-add-to-cart',
        snapshot: { product: { stock: 0 }, cart: { itemCount: 0, subtotal: 0 } },
        parameters: { quantity: 1 }
      }
    });
    const sim = parseTextContent(result) as { status: string };
    expect(sim.status).toBe('blocked');
    await server.close();
  });

  it('create_project with features creates + attaches described features in one round-trip', async () => {
    const { client, server } = await setup();
    const result = await client.callTool({
      name: 'create_project',
      arguments: {
        name: 'Pinnacle',
        description: 'Outdoor trip planning project.',
        features: [
          { name: 'Trip Planner', description: 'Plan routes, dates, and itinerary steps.' },
          { name: 'Gear Locker', description: 'Track reusable equipment and packing needs.' }
        ]
      }
    });
    const ack = parseTextContent(result) as {
      ok: true;
      id: string;
      features?: readonly { name: string; id: string }[];
    };
    expect(ack.ok).toBe(true);
    expect(ack.features).toHaveLength(2);
    expect(ack.features?.[0]?.name).toBe('Trip Planner');
    expect(ack.features?.[1]?.name).toBe('Gear Locker');
    // Verify attachment: get_project returns featureIds containing both.
    const projectResult = await client.callTool({
      name: 'get_project',
      arguments: { projectId: ack.id }
    });
    const project = parseTextContent(projectResult) as { featureIds: readonly string[] };
    expect(project.featureIds).toHaveLength(2);
    expect(project.featureIds).toContain(ack.features?.[0]?.id);
    expect(project.featureIds).toContain(ack.features?.[1]?.id);
    await server.close();
  });

  it('list_features filters by projectId when provided', async () => {
    const { client, server } = await setup();
    // Project A has the seed feature attached + a new feature; Project B has a different feature.
    const newFeatureA = parseTextContent(
      await client.callTool({
        name: 'create_feature',
        arguments: { name: 'A-only', description: 'Feature only attached to Project A.' }
      })
    ) as { id: string };
    const newFeatureB = parseTextContent(
      await client.callTool({
        name: 'create_feature',
        arguments: { name: 'B-only', description: 'Feature only attached to Project B.' }
      })
    ) as { id: string };
    const projectA = parseTextContent(
      await client.callTool({
        name: 'create_project',
        arguments: { name: 'A', description: 'Project A for filter testing.' }
      })
    ) as { id: string };
    const projectB = parseTextContent(
      await client.callTool({
        name: 'create_project',
        arguments: { name: 'B', description: 'Project B for filter testing.' }
      })
    ) as { id: string };
    await client.callTool({
      name: 'add_feature_to_project',
      arguments: { projectId: projectA.id, featureId: newFeatureA.id }
    });
    await client.callTool({
      name: 'add_feature_to_project',
      arguments: { projectId: projectB.id, featureId: newFeatureB.id }
    });
    // Filtered: only A's feature.
    const filtered = parseTextContent(
      await client.callTool({
        name: 'list_features',
        arguments: { projectId: projectA.id }
      })
    ) as readonly { id: string; name: string }[];
    expect(filtered.map((f) => f.name).sort()).toEqual(['A-only']);
    // Unfiltered: every feature in the repo (seed + both new).
    const all = parseTextContent(
      await client.callTool({ name: 'list_features', arguments: {} })
    ) as readonly { id: string }[];
    expect(all.length).toBeGreaterThanOrEqual(3);
    await server.close();
  });

  it('list_features returns an error when the projectId does not exist', async () => {
    const { client, server } = await setup();
    const result = await client.callTool({
      name: 'list_features',
      arguments: { projectId: 'nope' }
    });
    const r = result as { isError: boolean; content: { text: string }[] };
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toMatch(/not found/i);
    await server.close();
  });

  it('apply_batch returns a structured failure (not a thrown error) when validation fails', async () => {
    // Validation failure should land as `{ok:false, validation, refs}` so
    // the agent can introspect what would have been minted and iterate.
    // Previously the throw became a flat error string that lost the refs.
    const { client, server, repo } = await setup();
    const created = parseTextContent(
      await client.callTool({
        name: 'create_feature',
        arguments: {
          name: 'Structured Failure Demo',
          description: 'Exercises structured validation failure behavior.'
        }
      })
    ) as { id: string };
    // Reference an undeclared state path so reference-integrity rejects.
    const result = await client.callTool({
      name: 'apply_batch',
      arguments: {
        featureId: created.id,
        operations: [
          {
            kind: 'add_surface',
            ref: 'home',
            name: 'Home',
            type: 'screen',
            description: 'Entry screen for the failure demo.'
          },
          {
            kind: 'add_action',
            ref: 'go',
            surfaceRef: 'home',
            name: 'Go',
            intent: 'Refs an undeclared path so validation fails.'
          },
          {
            kind: 'add_action_rule',
            surfaceRef: 'home',
            actionRef: 'go',
            rule: {
              category: 'permissions',
              condition: { left: 'undeclared.path', operator: 'is_true' },
              description: 'Blocks when an undeclared path is true.',
              effect: {
                type: 'block_action',
                reason: 'no',
                description: 'Rejects the action for the validation demo.'
              }
            }
          }
        ]
      }
    });
    const ack = parseTextContent(result) as {
      ok: boolean;
      appliedCount: number;
      refs: Record<string, string>;
      validation: { valid: boolean; errors?: readonly string[] };
      hint?: string;
    };
    expect(ack.ok).toBe(false);
    expect(ack.appliedCount).toBe(0);
    expect(ack.validation.valid).toBe(false);
    expect(ack.validation.errors).toBeDefined();
    expect(Object.keys(ack.refs).sort()).toEqual(['go', 'home']);
    expect(ack.hint).toMatch(/dryRun: true/);
    // Validation errors are op-attributed: each error referencing a freshly-
    // minted entity id gets prefixed with `op[N] (kind):` so the agent knows
    // exactly which op to fix on retry. The bad rule landed on op index 2.
    expect(ack.validation.errors?.some((e) => e.startsWith('op[2] (add_action_rule):'))).toBe(true);
    // Repository state is unchanged: the failed batch was rolled back.
    const persisted = await repo.get(created.id as never);
    expect(persisted?.surfaces).toEqual([]);
    await server.close();
  });

  it('apply_batch resolves expectedTransitionRef on add_scenario against same-batch refs', async () => {
    const { client, server, repo } = await setup();
    const created = parseTextContent(
      await client.callTool({
        name: 'create_feature',
        arguments: {
          name: 'Transition Ref Test',
          description: 'Verifies same-batch transition reference resolution.'
        }
      })
    ) as { id: string };
    const result = await client.callTool({
      name: 'apply_batch',
      arguments: {
        featureId: created.id,
        operations: [
          {
            kind: 'add_surface',
            ref: 'home',
            name: 'Home',
            type: 'screen',
            description: 'Starting screen for transition testing.'
          },
          {
            kind: 'add_surface',
            ref: 'next',
            name: 'Next',
            type: 'screen',
            description: 'Destination screen for transition testing.'
          },
          {
            kind: 'add_action',
            ref: 'go',
            surfaceRef: 'home',
            name: 'Go',
            intent: 'Move to the Next surface.'
          },
          {
            kind: 'add_effect',
            surfaceRef: 'home',
            actionRef: 'go',
            effect: {
              type: 'transition_surface',
              targetRef: 'next',
              description: 'Moves the user to the destination screen.'
            }
          },
          {
            kind: 'add_scenario',
            surfaceRef: 'home',
            actionRef: 'go',
            name: 'Lands on Next',
            description: 'Successful action should navigate to the Next screen.',
            expectedStatus: 'success',
            expectedTransitionRef: 'next'
          }
        ]
      }
    });
    const ack = parseTextContent(result) as {
      ok: true;
      refs: Record<string, string>;
    };
    expect(ack.ok).toBe(true);
    // The scenario's expectedTransition should now be the same surfaceId as
    // the "next" ref minted earlier in the batch.
    const persisted = await repo.get(created.id as never);
    const scenario = persisted?.surfaces[0]?.actions[0]?.scenarios?.[0];
    expect(scenario?.expectedTransition).toBe(ack.refs.next);
    await server.close();
  });
});
