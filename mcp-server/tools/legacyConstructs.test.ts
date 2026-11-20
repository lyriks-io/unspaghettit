import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fixedClock } from '../../src/shared/domain/Clock';
import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import { InMemoryFeatureRepository } from '../../src/features/behavior-model/infrastructure/persistence/InMemoryFeatureRepository';
import { InMemoryProjectRepository } from '../../src/features/projects/infrastructure/persistence/InMemoryProjectRepository';
import type { Project } from '../../src/features/projects/domain/entities/Project';
import type { ProjectId } from '../../src/features/projects/domain/value-objects/ids';
import { asFeatureId } from '../../src/features/behavior-model/domain/value-objects/ids';
import { buildServer } from '../server';
import { applyOps } from './batch-ops/applyOps';
import type { Op } from './batch-ops/opHelpers';
import { blankFeature } from './simulateSteps';

/**
 * Every refusal the validator gained must refuse only what a write
 * INTRODUCES. A feature already holding the construct (written before the
 * check existed, on the Lyriks servers or a local hub) still takes an
 * unrelated batch, an unrelated granular write, an unrelated whole-feature save (the path the Lyriks
 * platform uses) and an unrelated draft replayed in memory (simulate_steps
 * operations, how Lyriks computes a change request), and a write adding the
 * construct again is refused.
 *
 * Each case builds the old feature with the batch operations themselves,
 * applied WITHOUT validation (as the data on disk was written before the
 * check), stores it as is, then drives the real MCP tools.
 */

const NOW = '2026-11-20T04:00:00.000Z';
const FEATURE = 'f-legacy';

let seq = 0;
const mint = () => `l${(seq++).toString(16).padStart(6, '0')}`;

/** A small, valid feature: a counter, a status, a list, a derived total, two actions. */
const baseOps = (): Op[] => [
  { kind: 'add_surface', ref: 's', name: 'Board', type: 'screen', description: 'The board.' },
  { kind: 'add_state_definition', surfaceRef: 's', path: 'n', type: 'number', defaultValue: 0, description: 'A count.' },
  { kind: 'add_state_definition', surfaceRef: 's', path: 'status', type: 'enum', enumValues: ['open', 'closed'], defaultValue: 'open', description: 'Status.' },
  { kind: 'add_state_definition', surfaceRef: 's', path: 'lines', type: 'array', defaultValue: [], description: 'Lines.' },
  {
    kind: 'add_state_definition',
    surfaceRef: 's',
    path: 'total',
    type: 'number',
    defaultValue: 0,
    description: 'Sum of the lines.',
    derived: { kind: 'sum', operand: { kind: 'state', path: 'lines' } }
  },
  { kind: 'add_action', ref: 'a', surfaceRef: 's', name: 'Count', intent: 'count one more', description: 'Counts.' },
  {
    kind: 'add_effect',
    surfaceRef: 's',
    actionRef: 'a',
    effect: { type: 'set_state', path: 'n', value: { kind: 'add', left: { kind: 'state', path: 'n' }, right: { kind: 'literal', value: 1 } }, description: 'One more.' }
  },
  { kind: 'add_action', ref: 'b', surfaceRef: 's', name: 'Close', intent: 'close the board', description: 'Closes.' },
  { kind: 'add_effect', surfaceRef: 's', actionRef: 'b', effect: { type: 'set_state', path: 'status', value: 'closed', description: 'Closed.' } }
];

const rule = (actionRef: string, condition: unknown): Op => ({
  kind: 'add_action_rule',
  surfaceRef: 's',
  actionRef,
  rule: { category: 'business', description: 'A gate.', condition, effect: { type: 'block_action', reason: 'No.', description: 'Refuse.' } }
});
const setN = (actionRef: string, value: unknown): Op => ({
  kind: 'add_effect',
  surfaceRef: 's',
  actionRef,
  effect: { type: 'set_state', path: 'n', value, description: 'Set n.' }
});
const scenario = (actionRef: string, body: Record<string, unknown>): Op => ({
  kind: 'add_scenario',
  surfaceRef: 's',
  actionRef,
  name: `Scenario of ${actionRef}`,
  description: 'A scenario.',
  ...body
});

/**
 * One case per refusal: the op that puts the construct in the old feature
 * (on action a), the op that introduces it again (on action b, or a second
 * element), and a fragment of the refusal.
 */
type Case = { readonly name: string; readonly legacy: Op; readonly introduce: Op; readonly refusal: RegExp };
const CASES: readonly Case[] = [
  {
    name: 'a comparison the types alone decide (7758a58)',
    legacy: rule('a', { left: 'n', operator: 'greater_than', right: '3' }),
    introduce: rule('b', { left: 'n', operator: 'equals', right: '3' }),
    refusal: /decided by the types alone/
  },
  {
    name: 'a goal compared with a value outside the enum (7758a58)',
    legacy: { kind: 'add_reachability_goal', goal: { name: 'Closd', kind: 'reachable', condition: { left: 'status', operator: 'equals', right: 'closd' }, description: 'd' } },
    introduce: { kind: 'add_reachability_goal', goal: { name: 'Clozed', kind: 'reachable', condition: { left: 'status', operator: 'equals', right: 'clozed' }, description: 'd' } },
    refusal: /is not one of the values "status" can hold/
  },
  {
    name: 'a scenario assertion of another type (7758a58)',
    legacy: scenario('a', { expectedAssertions: [{ path: 'n', operator: 'equals', value: '1', description: 'One.' }] }),
    introduce: scenario('b', { expectedAssertions: [{ path: 'n', operator: 'equals', value: '2', description: 'Two.' }] }),
    refusal: /expected assertion: compares "n"/
  },
  {
    name: 'a scenario start of another type (7758a58)',
    legacy: scenario('a', { stateOverrides: [{ path: 'n', value: 'two' }] }),
    introduce: scenario('b', { stateOverrides: [{ path: 'n', value: 'three' }] }),
    refusal: /stateOverride sets "three" \(a string\) into "n"/
  },
  {
    name: 'a persona start outside the enum (7758a58)',
    legacy: { kind: 'add_persona', name: 'Old', description: 'd', stateOverrides: [{ path: 'status', value: 'archived' }] },
    introduce: { kind: 'add_persona', name: 'New', description: 'd', stateOverrides: [{ path: 'status', value: 'gone' }] },
    refusal: /stateOverride sets "gone" is not one of the values/
  },
  {
    name: 'a list effect on a state that is not a list (7758a58)',
    legacy: { kind: 'add_effect', surfaceRef: 's', actionRef: 'a', effect: { type: 'append_to_list', path: 'n', item: 1, description: 'd' } },
    introduce: { kind: 'add_effect', surfaceRef: 's', actionRef: 'b', effect: { type: 'append_to_list', path: 'n', item: 2, description: 'd' } },
    refusal: /append_to_list targets "n", which is declared as number, not array/
  },
  {
    name: 'a state under one that holds a value (2d00d04)',
    legacy: { kind: 'add_state_definition', surfaceRef: 's', path: 'n.sub', type: 'number', defaultValue: 0, description: 'd' },
    introduce: { kind: 'add_state_definition', surfaceRef: 's', path: 'status.sub', type: 'number', defaultValue: 0, description: 'd' },
    refusal: /State "status.sub" sits under "status"/
  },
  {
    name: 'a start written into a derived state (522c05e)',
    legacy: scenario('a', { stateOverrides: [{ path: 'total', value: 5 }] }),
    introduce: scenario('b', { stateOverrides: [{ path: 'total', value: 9 }] }),
    refusal: /stateOverride sets "total", a derived path/
  },
  {
    name: 'a parameter bound to a derived state (522c05e)',
    legacy: { kind: 'add_parameter', surfaceRef: 's', actionRef: 'a', name: 'amount', type: 'number', required: false, bindToStatePath: 'total', description: 'd' },
    introduce: { kind: 'add_parameter', surfaceRef: 's', actionRef: 'b', name: 'amount', type: 'number', required: false, bindToStatePath: 'total', description: 'd' },
    refusal: /bindToStatePath "total" is a derived path/
  },
  {
    name: 'an object whose kind names no expression (36e8b31)',
    legacy: setN('a', { kind: 'multiply', left: { kind: 'state', path: 'n' }, right: 2 }),
    introduce: setN('b', { kind: 'times', left: { kind: 'state', path: 'n' }, right: 2 }),
    refusal: /"times" is not an expression kind/
  },
  {
    name: 'a switch without a default (36e8b31)',
    legacy: setN('a', { kind: 'switch', cases: [{ when: { left: 'n', operator: 'greater_than', right: 1 }, then: { kind: 'literal', value: 1 } }] }),
    introduce: setN('b', { kind: 'switch', cases: [{ when: { left: 'n', operator: 'greater_than', right: 2 }, then: { kind: 'literal', value: 2 } }] }),
    refusal: /"switch" has no "default"/
  },
  {
    name: 'an operator without an operand (36e8b31)',
    legacy: setN('a', { kind: 'add', left: { kind: 'state', path: 'n' } }),
    introduce: setN('b', { kind: 'mul', left: { kind: 'state', path: 'n' } }),
    refusal: /"mul" has no "right" operand/
  },
  {
    name: 'a state write among the blocked-attempt effects (a3f419f)',
    legacy: { kind: 'add_effect', surfaceRef: 's', actionRef: 'a', onBlocked: true, effect: { type: 'set_state', path: 'n', value: 0, description: 'd' } },
    introduce: { kind: 'add_effect', surfaceRef: 's', actionRef: 'b', onBlocked: true, effect: { type: 'set_state', path: 'n', value: 1, description: 'd' } },
    refusal: /writes state, and a blocked attempt writes none/
  },
  {
    name: 'a time advance that moves no time (8d7f466)',
    legacy: scenario('a', { timeAdvance: -5 }),
    introduce: scenario('b', { timeAdvance: -1 }),
    refusal: /timeAdvance -1 moves no time/
  },
  {
    name: 'a quantifier over a state that is not a list (e2f62f5)',
    legacy: rule('a', { kind: 'any_match', overPath: 'n', as: 'x', where: { left: 'x', operator: 'equals', right: 1 } }),
    introduce: rule('b', { kind: 'all_match', overPath: 'status', as: 'y', where: { left: 'y', operator: 'equals', right: 'open' } }),
    refusal: /all_match ranges over "status"/
  },
  {
    name: 'an outcome reading an undeclared state (d9808f9)',
    legacy: { kind: 'add_action_outcome', surfaceRef: 's', actionRef: 'a', name: 'Odd', outcomeKind: 'partial', description: 'd', condition: { left: 'nope', operator: 'exists' } },
    introduce: { kind: 'add_action_outcome', surfaceRef: 's', actionRef: 'b', name: 'Odder', outcomeKind: 'partial', description: 'd', condition: { left: 'neither', operator: 'exists' } },
    refusal: /neither/
  }
];

const rawText = (r: unknown): string => (r as { content: { text: string }[] }).content[0]!.text;
const errored = (r: unknown): boolean => (r as { isError?: boolean }).isError === true;

const setup = async (feature: Feature, project?: Omit<Project, 'id' | 'name' | 'description' | 'createdAt' | 'updatedAt'>) => {
  const repo = new InMemoryFeatureRepository();
  await repo.save(feature);
  const projectRepo = new InMemoryProjectRepository();
  if (project) {
    await projectRepo.save({
      id: 'p-legacy' as ProjectId,
      name: 'Legacy',
      description: 'Holds the old feature.',
      createdAt: NOW,
      updatedAt: NOW,
      ...project
    } as Project);
  }
  const server = buildServer(repo, { ids: mint, clock: fixedClock(NOW), projectRepo });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'legacy-test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
  /** True when the write landed. */
  const batch = async (operations: readonly Op[]): Promise<{ ok: boolean; text: string }> => {
    const r = await call('apply_batch', { featureId: String(feature.id), operations });
    const raw = rawText(r);
    if (errored(r)) return { ok: false, text: raw };
    const answer = JSON.parse(raw) as { ok?: boolean; validation?: { errors?: readonly string[] } };
    return { ok: answer.ok === true, text: (answer.validation?.errors ?? []).join('\n') };
  };
  const save = async (next: Feature): Promise<{ ok: boolean; text: string }> => {
    const r = await call('save_feature', { feature: next as unknown as Record<string, unknown> });
    return { ok: !errored(r), text: rawText(r) };
  };
  /** A draft replayed in memory (how Lyriks computes a change request): true when it computes. */
  const draft = async (operations: readonly Op[]): Promise<{ ok: boolean; text: string }> => {
    const r = await call('simulate_steps', { featureId: String(feature.id), operations, includeFeature: true });
    const raw = rawText(r);
    if (errored(r)) return { ok: false, text: raw };
    const answer = JSON.parse(raw) as { ok?: boolean; errors?: readonly string[] };
    return { ok: answer.ok === true, text: (answer.errors ?? []).join('\n') };
  };
  /** A granular write tool (the MutateFeature path): true when it landed. */
  const granular = async (name: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }> => {
    const r = await call(name, { featureId: String(feature.id), ...args });
    return { ok: !errored(r), text: rawText(r) };
  };
  return { repo, server, batch, save, draft, granular };
};

/** The old feature: the valid base plus the construct, applied without any validation. */
const oldFeature = (legacy: readonly Op[]): { feature: Feature; surfaceId: string; refs: Record<string, string> } => {
  const built = applyOps(blankFeature(FEATURE, 'Legacy'), [...baseOps(), ...legacy], mint);
  return { feature: built.next, surfaceId: built.refs.s!, refs: built.refs };
};

/** Turn the refs of baseOps into ids, for ops sent to the server after the fact. */
const withIds = (op: Op, refs: Record<string, string>): Op => {
  const out: Record<string, unknown> = { ...op };
  if (op.surfaceRef) {
    delete out.surfaceRef;
    out.surfaceId = refs[op.surfaceRef as string];
  }
  if (op.actionRef) {
    delete out.actionRef;
    out.actionId = refs[op.actionRef as string];
  }
  return out as Op;
};

describe('a refusal the validator gained never blocks a write that does not introduce it', () => {
  it.each(CASES)('$name', async ({ legacy, introduce, refusal }) => {
    const { feature, surfaceId, refs } = oldFeature([legacy]);
    const { repo, server, batch, save, draft, granular } = await setup(feature);

    // An unrelated granular write lands.
    const renamed = await granular('update_surface', { surfaceId, name: 'Board, by a granular tool' });
    expect(renamed.text).not.toMatch(refusal);
    expect(renamed.ok).toBe(true);

    // An unrelated draft replayed over the old feature computes.
    const replayed = await draft([{ kind: 'update_surface', surfaceId, name: 'Board, in a draft' }]);
    expect(replayed.text).not.toMatch(refusal);
    expect(replayed.ok).toBe(true);

    // An unrelated batch lands on the old feature.
    const unrelated = await batch([{ kind: 'update_surface', surfaceId, name: 'Board, renamed' }]);
    expect(unrelated.text).not.toMatch(refusal);
    expect(unrelated.ok).toBe(true);

    // An unrelated whole-feature save (the Lyriks platform's path) lands too.
    const stored = (await repo.get(asFeatureId(FEATURE)))!;
    const saved = await save({ ...stored, description: 'Saved again by the platform.' });
    expect(saved.text).not.toMatch(refusal);
    expect(saved.ok).toBe(true);
    expect((await repo.get(asFeatureId(FEATURE)))!.description).toBe('Saved again by the platform.');

    // A batch, or a draft, that introduces the construct again is refused, naming it.
    const again = await batch([withIds(introduce, refs)]);
    expect(again.ok).toBe(false);
    expect(again.text).toMatch(refusal);
    const drafted = await draft([withIds(introduce, refs)]);
    expect(drafted.ok).toBe(false);
    expect(drafted.text).toMatch(refusal);
    await server.close();
  });
});

describe('the project-invariant guard on a whole-feature save (d945d57)', () => {
  const invariantOver = (path: string) => ({
    id: `inv-${path}`,
    name: `Bounded ${path}`,
    condition: { left: path, operator: 'lower_or_equal', right: 10 },
    message: 'Stays bounded.'
  });

  it('lets an unrelated save land, refuses a save that drops the state the invariant reads', async () => {
    const { feature } = oldFeature([]);
    const { repo, server, save } = await setup(feature, {
      featureIds: [asFeatureId(FEATURE)],
      projectInvariants: [invariantOver('n')]
    } as never);
    const stored = (await repo.get(asFeatureId(FEATURE)))!;
    expect((await save({ ...stored, description: 'An unrelated save.' })).ok).toBe(true);

    const current = (await repo.get(asFeatureId(FEATURE)))!;
    const withoutN: Feature = {
      ...current,
      surfaces: current.surfaces.map((s) => ({ ...s, stateDefinitions: s.stateDefinitions.filter((d) => String(d.path) !== 'n'), actions: [] }))
    };
    const dropped = await save(withoutN);
    expect(dropped.ok).toBe(false);
    expect(dropped.text).toMatch(/project invariant "Bounded n"/);
    await server.close();
  });

  it('does not block an unrelated save, batch or granular write when an invariant already reads a state no feature declares', async () => {
    const { feature, surfaceId } = oldFeature([]);
    const { repo, server, save, batch, granular } = await setup(feature, {
      featureIds: [asFeatureId(FEATURE)],
      projectInvariants: [invariantOver('gone.long.ago'), invariantOver('n')]
    } as never);
    const stored = (await repo.get(asFeatureId(FEATURE)))!;
    expect((await save({ ...stored, description: 'Still saves.' })).ok).toBe(true);
    expect((await batch([{ kind: 'update_surface', surfaceId, name: 'Renamed in a batch' }])).ok).toBe(true);
    expect((await granular('update_surface', { surfaceId, name: 'Renamed by a tool' })).ok).toBe(true);
    await server.close();
  });
});
