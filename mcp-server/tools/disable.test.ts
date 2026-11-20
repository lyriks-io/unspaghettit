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
import { stable } from '../../src/features/behavior-model/domain/services/FeatureElementVersions';
import { unavailableProver } from '../../src/features/prover/unavailableProver';
import type { Prover } from '../../src/features/prover/ProverPort';
import {
  ADRIEN,
  VALIDATION,
  validationFeature
} from '../../src/features/behavior-model/domain/services/DisabledElements.fixture';
import { buildServer } from '../server';

/**
 * Disabling an element through the engine's tools: the two batch operations,
 * and every reading taking the model without what is disabled while the
 * reads that show the model as written still show it, marked.
 */

const NOW = '2026-11-18T10:00:00.000Z';
const PROJECT_ID = 'proj-validation' as ProjectId;

const rawText = (r: unknown): string => {
  const content = (r as { content?: readonly { type: string; text: string }[] }).content;
  const first = content?.[0];
  if (!first || first.type !== 'text') throw new Error('expected text content');
  return first.text;
};
const parse = <T = Record<string, unknown>>(r: unknown): T => JSON.parse(rawText(r)) as T;
const errored = (r: unknown): boolean => (r as { isError?: boolean }).isError === true;

/**
 * A proof module that proves nothing but says what it was given, and keeps
 * each answer by the content of the feature it proved, as the real one does.
 */
const recordingProver = (): Prover & { readonly seen: string[][] } => {
  const seen: string[][] = [];
  const kept = new Map<string, number>();
  const base = unavailableProver('recording-prover', 'test double');
  const rulesOf = (f: Feature) => f.surfaces.flatMap((s) => s.actions.flatMap((a) => a.rules.map((r) => String(r.id))));
  return {
    ...base,
    seen,
    specGaps: async (feature, ctx) => {
      seen.push(rulesOf(feature));
      return base.specGaps(feature, ctx);
    },
    tools: (host) => [
      {
        name: 'prove_feature_rules',
        description: 'Answers the rules it proved and whether the proof was kept.',
        inputSchema: (z) => ({ featureId: z.string() }),
        run: async (input) => {
          const feature = await host.features.get(String(input.featureId));
          if (!feature) return { error: 'not found' };
          const { updatedAt: _u, elementVersions: _v, ...content } = feature;
          const key = stable(content);
          const reused = kept.has(key);
          kept.set(key, (kept.get(key) ?? 0) + 1);
          return { value: { rules: rulesOf(feature), reused } };
        }
      }
    ]
  };
};

const setup = async () => {
  const repo = new InMemoryFeatureRepository();
  await repo.save(validationFeature());
  const projectRepo = new InMemoryProjectRepository();
  const project: Project = {
    id: PROJECT_ID,
    name: 'Validation',
    description: 'Owns the validation feature.',
    featureIds: [asFeatureId(VALIDATION.feature)],
    createdAt: NOW,
    updatedAt: NOW
  };
  await projectRepo.save(project);
  let n = 0;
  const prover = recordingProver();
  const server = buildServer(repo, {
    ids: () => `id-${n++}`,
    clock: fixedClock(NOW),
    projectRepo,
    prover: { state: 'loaded', prover }
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
  // A refused op answers an error sentence naming the op and the refusal.
  const batch = (operations: Record<string, unknown>[]) =>
    call('apply_batch', { featureId: VALIDATION.feature, operations }).then((r) =>
      errored(r) ? { ok: false, error: rawText(r) } : parse<{ ok: boolean; error?: string }>(r)
    );
  const disable = (elementId: string, reason = ADRIEN.reason) =>
    batch([{ kind: 'disable_element', elementId, reason, by: ADRIEN.by }]);
  return { client, server, repo, call, batch, disable, prover };
};

const readFeature = async (repo: InMemoryFeatureRepository) => (await repo.get(asFeatureId(VALIDATION.feature)))!;

describe('disable_element and enable_element in apply_batch', () => {
  it('disables an element by id with a reason, stamped with who and when [criterion:ac-leaf-e40ccfa1-2c1e-46ce-a6c3-175cea42b47c]', async () => {
    const { repo, disable, server } = await setup();
    expect(await disable(VALIDATION.viewerRule)).toMatchObject({ ok: true });
    const rule = (await readFeature(repo)).surfaces[0]!.actions[0]!.rules[0]!;
    expect(rule.disabled).toEqual({ by: ADRIEN.by, at: NOW, reason: ADRIEN.reason });
    await server.close();
  });

  it('enables it again under the same id', async () => {
    const { repo, disable, batch, server } = await setup();
    await disable(VALIDATION.viewerRule);
    expect(await batch([{ kind: 'enable_element', elementId: VALIDATION.viewerRule }])).toMatchObject({ ok: true });
    const rule = (await readFeature(repo)).surfaces[0]!.actions[0]!.rules[0]!;
    expect(String(rule.id)).toBe(VALIDATION.viewerRule);
    expect(rule.disabled).toBeUndefined();
    await server.close();
  });

  it('keeps the element readable in the model as written, marked [criterion:ac-leaf-7fed852b-f6a7-40c6-b6d8-8dbc26bd495e]', async () => {
    const { call, disable, server } = await setup();
    await disable(VALIDATION.validate);
    const read = parse<{ action: { id: string; disabled?: unknown; rules: { id: string }[] } }>(
      await call('get_action', { featureId: VALIDATION.feature, actionId: VALIDATION.validate })
    );
    expect(read.action.disabled).toEqual({ by: ADRIEN.by, at: NOW, reason: ADRIEN.reason });
    expect(read.action.rules.map((r) => r.id)).toEqual([VALIDATION.viewerRule]);
    await server.close();
  });

  it('refuses an empty reason, a second disable, a second enable and an unknown id, applying nothing [criterion:ac-leaf-0cecabc1-8797-4128-b40c-84dcfaee0296]', async () => {
    const { repo, disable, batch, server } = await setup();
    const before = await readFeature(repo);
    const noReason = await disable(VALIDATION.viewerRule, '');
    expect(noReason).toMatchObject({ ok: false });
    expect(noReason.error).toContain('Say why the element is disabled.');
    expect(await readFeature(repo)).toEqual(before);

    const unknown = await batch([{ kind: 'disable_element', elementId: 'no-such-id', reason: 'Testing' }]);
    expect(unknown.error).toContain('No element of this feature has that id: no-such-id');
    expect(await readFeature(repo)).toEqual(before);

    const enableInForce = await batch([{ kind: 'enable_element', elementId: VALIDATION.viewerRule }]);
    expect(enableInForce.error).toContain('This element is enabled already.');
    expect(await readFeature(repo)).toEqual(before);

    await disable(VALIDATION.viewerRule);
    const once = await readFeature(repo);
    const twice = await batch([{ kind: 'disable_element', elementId: VALIDATION.viewerRule, reason: 'Again', by: 'Someone else' }]);
    expect(twice.error).toContain('This element is disabled already.');
    expect(await readFeature(repo)).toEqual(once);
    await server.close();
  });
});

describe('every reading leaves the disabled elements out', () => {
  it('runs no scenario of a disabled element and counts it apart [criterion:ac-leaf-7c70d116-f395-4fd1-9e12-d41790f6e070]', async () => {
    const { call, disable, server } = await setup();
    await disable(VALIDATION.validate);
    const run = parse<{ total: number; disabled?: { total: number; scenarios: { scenarioId: string }[] } }>(
      await call('run_all_scenarios', { featureId: VALIDATION.feature })
    );
    expect(run.total).toBe(0);
    expect(run.disabled?.total).toBe(3);
    expect(run.disabled?.scenarios.map((s) => s.scenarioId).sort()).toEqual(
      [VALIDATION.editorScenario, VALIDATION.viewerScenario, VALIDATION.reopenScenario].sort()
    );
    await server.close();
  });

  it('walks, runs the scenarios and model-checks the model without them [criterion:ac-leaf-fdd4a79e-cc1f-44bd-a1a7-4cc6f31a5a26]', async () => {
    const { call, disable, server } = await setup();
    await disable(VALIDATION.goal);
    await disable(VALIDATION.reopen);
    const answer = parse<{
      scenarios: { run: number; disabled?: { total: number } };
      modelCheck: { goalResults: unknown[] };
    }>(await call('simulate_steps', { featureId: VALIDATION.feature, runScenarios: true, modelCheck: true }));
    expect(answer.scenarios.run).toBe(2);
    expect(answer.scenarios.disabled?.total).toBe(1);
    expect(answer.modelCheck.goalResults).toEqual([]);
    expect(JSON.stringify(answer.modelCheck)).not.toContain(VALIDATION.reopen);

    const walk = await call('simulate_steps', { featureId: VALIDATION.feature, steps: [{ actionId: VALIDATION.reopen }] });
    expect(errored(walk)).toBe(true);
    expect(rawText(walk)).toContain('is disabled');
    const dry = await call('dry_run_simulate', { featureId: VALIDATION.feature, surfaceId: VALIDATION.surface, actionId: VALIDATION.reopen });
    expect(rawText(dry)).toContain('is disabled');
    await server.close();
  });

  it('disables elements in memory for one trial and saves nothing [criterion:ac-leaf-27ca9a00-8cd5-4213-903d-30384ab0af2d]', async () => {
    const { call, repo, server } = await setup();
    const before = await readFeature(repo);
    const trial = parse<{ steps: { status: string }[] }>(
      await call('simulate_steps', {
        featureId: VALIDATION.feature,
        disable: [VALIDATION.viewerRule, VALIDATION.invariant],
        snapshot: { 'session.role': 'viewer' },
        steps: [{ actionId: VALIDATION.validate }]
      })
    );
    expect(trial.steps[0]?.status).toBe('success');
    expect(await readFeature(repo)).toEqual(before);
    await server.close();
  });

  it('refuses a trial that names an id the feature does not hold, with that id [criterion:ac-leaf-4d11b243-1cc7-4377-bff1-028e75887b02]', async () => {
    const { call, server } = await setup();
    const trial = await call('simulate_steps', { featureId: VALIDATION.feature, disable: ['rule-ghost'], runScenarios: true });
    expect(errored(trial)).toBe(true);
    expect(rawText(trial)).toContain('rule-ghost');
    await server.close();
  });

  it('proves without the disabled elements, in the spec gaps and in a proof tool [criterion:ac-leaf-61afcec9-fa08-4043-b6c3-9ea40d28348f]', async () => {
    const { call, disable, prover, server } = await setup();
    await disable(VALIDATION.viewerRule);
    await call('get_spec_gaps', { featureId: VALIDATION.feature });
    expect(prover.seen.at(-1)).toEqual([VALIDATION.reopenRule]);
    const proof = parse<{ rules: string[] }>(await call('prove_feature_rules', { featureId: VALIDATION.feature }));
    expect(proof.rules).toEqual([VALIDATION.reopenRule]);
    await server.close();
  });

  it('reads again a proof kept from before an element was disabled [criterion:ac-leaf-05a1f32d-5f1b-4a5b-947e-95cc26fd0236]', async () => {
    const { call, disable, batch, server } = await setup();
    const prove = async () => parse<{ reused: boolean }>(await call('prove_feature_rules', { featureId: VALIDATION.feature })).reused;
    expect(await prove()).toBe(false);
    expect(await prove()).toBe(true);
    await disable(VALIDATION.viewerRule);
    // The feature reads otherwise now: the proof kept before is not read back.
    expect(await prove()).toBe(false);
    await batch([{ kind: 'enable_element', elementId: VALIDATION.viewerRule }]);
    expect(await prove()).toBe(true);
    await server.close();
  });
});

describe('the implementation index reads a disabled element disabled', () => {
  const INDEX = {
    [`action:${VALIDATION.validate}`]: { status: 'implemented', file: 'src/validate.ts', line: 3, signature: 'export function validate() {', specVersion: '2026-11-17T00:00:00.000Z' },
    [`rule:${VALIDATION.viewerRule}`]: { status: 'implemented', file: 'src/validate.ts', line: 4, signature: "if (role === 'viewer') throw refused();", specVersion: '2026-11-17T00:00:00.000Z' }
  };

  it('keeps its index entries: they resolve, never orphans [criterion:ac-leaf-828a267d-6a27-458d-9552-1490b064b750]', async () => {
    const { call, disable, server } = await setup();
    await disable(VALIDATION.validate);
    const synced = parse<{ ok: boolean; orphans: { total: number } }>(
      await call('sync_from_index', { index: INDEX, projectId: PROJECT_ID })
    );
    expect(synced.orphans.total).toBe(0);
    expect(synced.ok).toBe(true);
    await server.close();
  });

  it('reads it disabled in the gaps, the status and the drift, neither missing nor drifting [criterion:ac-leaf-b881376b-8eba-4677-a79c-7c6cff34891c]', async () => {
    const { call, disable, server } = await setup();
    await disable(VALIDATION.validate);
    const gaps = parse<{ missing: { key: string }[]; disabled?: { key: string; disabled: unknown }[]; stats: { disabled?: number } }>(
      await call('get_implementation_gaps', { featureId: VALIDATION.feature, index: {}, projectId: PROJECT_ID })
    );
    expect(gaps.missing.map((e) => e.key)).not.toContain(`action:${VALIDATION.validate}`);
    expect(gaps.disabled?.map((e) => e.key)).toEqual([`action:${VALIDATION.validate}`]);
    expect(gaps.stats.disabled).toBe(1);

    // Synced with its action located and its rule not: the rule would read missing.
    await call('sync_from_index', { index: { [`action:${VALIDATION.validate}`]: INDEX[`action:${VALIDATION.validate}`] }, projectId: PROJECT_ID });
    const status = parse<{ actions: { actionId: string; disabled?: unknown; missingEntities: unknown[]; disabledEntities?: { entityId: string }[] }[] }>(
      await call('get_implementation_status', { featureId: VALIDATION.feature })
    );
    const row = status.actions.find((a) => a.actionId === VALIDATION.validate)!;
    expect(row.disabled).toEqual({ by: ADRIEN.by, at: NOW, reason: ADRIEN.reason });
    expect(row.missingEntities).toEqual([]);
    expect(row.disabledEntities?.map((e) => e.entityId)).toEqual([VALIDATION.viewerRule]);

    const drift = parse<{ stale: { key: string }[]; orphans: unknown[]; disabled?: string[] }>(
      await call('get_drift', { featureId: VALIDATION.feature, index: INDEX })
    );
    expect(drift.stale).toEqual([]);
    expect(drift.orphans).toEqual([]);
    expect(drift.disabled?.sort()).toEqual([`action:${VALIDATION.validate}`, `rule:${VALIDATION.viewerRule}`]);
    await server.close();
  });
});

describe('the gaps read the events of a disabled action disabled', () => {
  // An event the disabled action alone emits goes with it, and carries the
  // marker of that action: listed missing, it asked for code to be written for
  // an emission nothing in force makes.
  it('lists an event only the disabled action emits under disabled, with its marker', async () => {
    const { call, repo, disable, server } = await setup();
    const base = await readFeature(repo);
    await repo.save({
      ...base,
      events: [{ id: 'evt-validated', name: 'element.validated' } as unknown as NonNullable<Feature['events']>[number]],
      surfaces: base.surfaces.map((s) => ({
        ...s,
        actions: s.actions.map((a) =>
          String(a.id) === VALIDATION.validate ? { ...a, emittedEvents: ['element.validated' as never] } : a
        )
      }))
    });
    await disable(VALIDATION.validate);
    const gaps = parse<{ missing: { key: string }[]; disabled?: { key: string; disabled?: unknown }[] }>(
      await call('get_implementation_gaps', { featureId: VALIDATION.feature, index: {}, projectId: PROJECT_ID })
    );
    expect(gaps.missing.map((e) => e.key)).not.toContain('event:element.validated');
    const row = gaps.disabled?.find((e) => e.key === 'event:element.validated');
    expect(row?.disabled).toEqual({ by: ADRIEN.by, at: NOW, reason: ADRIEN.reason });
    await server.close();
  });
});
