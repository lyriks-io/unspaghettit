import { z } from 'zod';
import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import type { Invariant } from '../../src/features/behavior-model/domain/entities/Invariant';
import { introducedValidationErrors } from '../../src/features/behavior-model/domain/services/FeatureValidator';
import { normalizeFeatureEmittedEvents } from '../../src/features/behavior-model/domain/services/FeatureEmittedEventsNormalizer';
import type { ParameterValues } from '../../src/features/behavior-model/domain/services/ParameterValidator';
import { asFeatureId } from '../../src/features/behavior-model/domain/value-objects/ids';
import type { StateSnapshot } from '../../src/features/behavior-model/domain/value-objects/StatePath';
import { batchScenariosTool } from '../../src/features/mcp-tools/application/tools/batchScenarios';
import { runScenariosUseCase } from '../../src/features/simulator/application/use-cases/RunScenarios';
import {
  simulateSteps,
  WalkStepNotFoundError,
  type WalkStep
} from '../../src/features/simulator/application/use-cases/SimulateSteps';
import { exploreStateSpace } from '../../src/features/simulator/domain/StateExplorer';
import { analyzeSurfaceReachability } from '../../src/features/simulator/domain/SurfaceReachability';
import { scenarioVerdict } from '../../src/features/verification/domain/aggregateVerdict';
import {
  recordingIdGenerator,
  replayingIdGenerator
} from '../../src/shared/domain/IdGenerator';
import { trackTokens } from '../metrics';
import { applyOps } from './batch-ops/applyOps';
import type { Op } from './batch-ops/opHelpers';
import { collectFeatureEntityIds } from './short-ids';
import { findOwningProject } from '../../src/features/projects/application/services/bulkRead';
import { asProjectId } from '../../src/features/projects/domain/value-objects/ids';
import { activeProver } from '../../src/features/prover/loadProver';
import { errorText, text, type ToolDeps } from './_shared';

/** The most steps one walk runs: a flow, not a load test. */
export const MAX_WALK_STEPS = 50;

/**
 * A feature with nothing in it yet, for a walk over a feature that does not
 * exist: the batch of the call builds it, in memory, and nothing is saved.
 */
export const blankFeature = (id: string, name: string): Feature => ({
  id: asFeatureId(id),
  name,
  description: '',
  surfaces: [],
  personas: [],
  resources: [],
  entities: [],
  events: [],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString()
});

const stepSchema = z.object({
  actionId: z.string().optional(),
  actionRef: z.string().optional(),
  surfaceId: z.string().optional(),
  surfaceRef: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  timeAdvance: z.number().optional()
});

const runScenarios = runScenariosUseCase();

/** Every scenario of the feature, as a compact report: failures only as rows. */
const allScenarios = (
  feature: Feature,
  projectFeatures: readonly Feature[] | undefined,
  projectInvariants: readonly Invariant[]
) => {
  const output = runScenarios({
    feature,
    ...(projectFeatures ? { projectFeatures } : {}),
    ...(projectInvariants.length > 0 ? { projectInvariants } : {})
  });
  return {
    run: output.total,
    passed: output.passed,
    failed: output.results
      .filter((result) => !result.pass)
      .map(scenarioVerdict)
      .map((row) => ({
        scenarioId: row.scenarioId,
        name: row.scenarioName,
        actionId: row.actionId,
        actionName: row.actionName,
        expectedStatus: row.expectedStatus,
        actualStatus: row.actualStatus,
        reason: row.reason
      }))
  };
};

export const registerSimulateStepsTool = ({ server, repo, projectRepo, ids, prover: proverState }: ToolDeps): void => {
  // The proof module, where one was asked for: the exploration tries its inputs first.
  const prover = activeProver(proverState ?? { state: 'not-asked' });
  server.registerTool(
    'simulate_steps',
    {
      description:
        'Simulate a feature WITHOUT saving anything. Walk it step by step: run a sequence of actions from a starting state, threading the state from one to the next, and read what each step did: `status` (success | blocked), `refusedBecause` (the reason of the rule that refused it, a rejected input, a broken invariant), `changes` ([{ path, before, after }] for every state path it moved), `messages`, `emittedEvents`, `movedTo` (the surface it navigated to, or null), `outcome`, and `cascaded` (the event handlers it woke up). A refused step changes nothing and the walk continues from the same state (`stopOnBlocked:true` ends it there; `notRun` counts what was left). The walk ends with `finalState`. `snapshot` is the state to start from, over the declared defaults; `personaId` applies a persona first. A step is { actionId, surfaceId?, parameters?, timeAdvance? }; `$channel` among the parameters says which channel the call arrives through. `runScenarios:true` also runs every scenario of the feature (`scenarios: { run, passed, failed[] }`), and `modelCheck:true` (or { maxDepth, maxStates }) explores its state space like model_check (`modelCheck: { ...report, reachability }`, with `proof` beside it where a proof module is loaded). Steps are optional when one of those is asked. A FEATURE THAT IS NOT SAVED: `operations` (the apply_batch vocabulary) are applied IN MEMORY first, validated the way apply_batch validates them, and never saved; a step may name what they created with `actionRef` / `surfaceRef`. With no `featureId`, or `blank:true`, they build on an empty feature. To keep a model across calls, store the `mintedIds` an answer returns and send them back with the same operations: every id is minted again exactly as before, so a later batch can address what an earlier one created. `newOperationsFrom:<n>` marks the operations from index n on as the new ones: `batch.created` and `batch.scenarios` then describe those alone, like an apply_batch answer. `includeFeature:true` returns the resulting feature. A batch that fails validation answers { ok:false, errors } and runs nothing.',
      inputSchema: {
        featureId: z.string().optional(),
        blank: z
          .boolean()
          .optional()
          .describe('Simulate an empty feature (named featureId when given) instead of a stored one.'),
        operations: z
          .array(z.record(z.string(), z.unknown()))
          .optional()
          .describe('apply_batch operations applied in memory before anything runs, never saved.'),
        mintedIds: z
          .array(z.string())
          .optional()
          .describe('The mintedIds of an earlier answer over the same operations: replayed so every id comes out the same.'),
        newOperationsFrom: z.number().int().min(0).optional(),
        steps: z.array(stepSchema).max(MAX_WALK_STEPS).optional(),
        snapshot: z.record(z.string(), z.unknown()).optional(),
        personaId: z.string().optional(),
        stopOnBlocked: z.boolean().optional(),
        runScenarios: z.boolean().optional(),
        modelCheck: z
          .union([
            z.boolean(),
            z.object({
              maxDepth: z.number().int().positive().optional(),
              maxStates: z.number().int().positive().optional()
            })
          ])
          .optional(),
        includeFeature: z.boolean().optional(),
        projectId: z
          .string()
          .optional()
          .describe(
            'The project the simulated feature belongs to, when the store cannot tell (an empty feature, a draft). Defaults to the project that owns featureId.'
          )
      }
    },
    async (input) => {
      const { featureId, blank, operations, steps = [] } = input;
      if (steps.length === 0 && !input.runScenarios && !input.modelCheck && !input.includeFeature && !operations?.length) {
        return errorText(
          'simulate_steps needs something to do: steps, runScenarios, modelCheck, includeFeature or operations to validate.'
        );
      }
      let base: Feature | null = null;
      if (featureId && blank !== true) {
        base = await repo.get(asFeatureId(featureId));
        if (!base) {
          return errorText(
            `Feature ${featureId} not found. Pass blank:true to simulate an empty feature built by \`operations\`.`
          );
        }
      } else {
        base = blankFeature(featureId ?? 'scratch', 'Scratch feature');
      }

      let feature = base;
      let refs: Record<string, string> = {};
      let batch: Record<string, unknown> | undefined;
      if (operations && operations.length > 0) {
        try {
          const ops = operations as readonly Op[];
          const taken = collectFeatureEntityIds(base);
          const recorder = recordingIdGenerator(
            replayingIdGenerator(input.mintedIds ?? [], ids, (id) => taken.has(id))
          );
          const applied = applyOps(base, ops, recorder.mint);
          const next = normalizeFeatureEmittedEvents(applied.next);
          const errors = introducedValidationErrors(normalizeFeatureEmittedEvents(base), next);
          if (errors.length > 0) {
            return text({ ok: false, persisted: false, errors });
          }
          feature = next;
          refs = { ...applied.refs };
          const from = Math.min(input.newOperationsFrom ?? 0, ops.length);
          // What the NEW operations did, measured against the model before them,
          // replayed with the same ids so the two sides line up.
          let scenarios: unknown;
          if (input.newOperationsFrom !== undefined) {
            const before = normalizeFeatureEmittedEvents(
              applyOps(
                base,
                ops.slice(0, from),
                replayingIdGenerator(input.mintedIds ?? [], ids, (id) => taken.has(id))
              ).next
            );
            scenarios = batchScenariosTool(before, next);
          }
          batch = {
            appliedCount: ops.length - from,
            refs: applied.refs,
            created: applied.created
              .filter((row) => row.op >= from)
              .map((row) => ({ ...row, op: row.op - from })),
            ...(scenarios ? { scenarios } : {}),
            mintedIds: [...recorder.minted]
          };
        } catch (e) {
          return text({ ok: false, persisted: false, errors: [(e as Error).message] });
        }
      }

      const resolveRef = (ref: string | undefined, id: string | undefined, what: string) => {
        if (ref) {
          const minted = refs[ref];
          if (!minted) throw new WalkStepNotFoundError(`Unknown ${what} "${ref}": no op of this call set it.`);
          return minted;
        }
        return id;
      };
      let walkSteps: WalkStep[];
      try {
        walkSteps = steps.map((s, i) => {
          const actionId = resolveRef(s.actionRef, s.actionId, 'actionRef');
          if (!actionId) throw new WalkStepNotFoundError(`Step ${i}: actionId or actionRef is required.`);
          const surfaceId = resolveRef(s.surfaceRef, s.surfaceId, 'surfaceRef');
          return {
            actionId,
            ...(surfaceId ? { surfaceId } : {}),
            ...(s.parameters ? { parameters: s.parameters as ParameterValues } : {}),
            ...(s.timeAdvance !== undefined ? { timeAdvance: s.timeAdvance } : {})
          };
        });
      } catch (e) {
        return errorText((e as Error).message);
      }

      // The project gives the walk its neighbours (event handlers elsewhere),
      // its cross-feature invariants, and the other features' state those
      // invariants read, seeded from their defaults as verify seeds them.
      const project = await (input.projectId
        ? projectRepo.get(asProjectId(input.projectId))
        : featureId
          ? findOwningProject(projectRepo, featureId)
          : Promise.resolve(null)
      ).catch(() => null);
      const projectFeatures = project
        ? (
            await Promise.all(
              project.featureIds
                .filter((id) => String(id) !== String(feature.id))
                .map((id) => repo.get(id))
            )
          ).filter((f): f is Feature => f !== null)
        : undefined;
      const projectInvariants = project?.projectInvariants ?? [];
      const seedStateDefs = (projectFeatures ?? []).flatMap((f) =>
        f.surfaces.flatMap((s) => s.stateDefinitions)
      );
      const crossFeature =
        projectInvariants.length > 0 ? { extraInvariants: projectInvariants, seedStateDefs } : {};
      try {
        const walk =
          walkSteps.length > 0
            ? simulateSteps({
                feature,
                steps: walkSteps,
                ...(input.snapshot ? { snapshot: input.snapshot as StateSnapshot } : {}),
                ...(input.personaId ? { personaId: refs[input.personaId] ?? input.personaId } : {}),
                ...(projectFeatures ? { projectFeatures } : {}),
                ...(input.stopOnBlocked ? { stopOnBlocked: true } : {}),
                ...crossFeature
              })
            : undefined;
        const modelCheckOptions =
          typeof input.modelCheck === 'object' ? input.modelCheck : {};
        // The proof module proves the same feature; the exploration tries its inputs first.
        const aid =
          input.modelCheck && prover
            ? await prover.explorationAid(feature, {
                projectFeatures: [feature, ...(projectFeatures ?? [])],
                ...(projectInvariants.length > 0 ? { projectInvariants } : {}),
                ...(modelCheckOptions.maxDepth !== undefined ? { maxSteps: modelCheckOptions.maxDepth } : {})
              })
            : null;
        const witnessed = aid?.witnessedInputs ?? new Map();
        return text(
          trackTokens('simulate_steps', {
            ok: true,
            persisted: false,
            featureId: String(feature.id),
            ...(batch ? { batch } : {}),
            ...(walk ?? {}),
            ...(input.runScenarios ? { scenarios: allScenarios(feature, projectFeatures, projectInvariants) } : {}),
            ...(input.modelCheck
              ? {
                  modelCheck: {
                    ...exploreStateSpace(
                      feature,
                      {
                        ...modelCheckOptions,
                        ...crossFeature,
                        ...(witnessed.size > 0 ? { witnessedInputs: witnessed } : {})
                      },
                      projectFeatures
                    ),
                    reachability: analyzeSurfaceReachability(feature),
                    ...(aid ? { proof: aid.readout } : {})
                  }
                }
              : {}),
            ...(input.includeFeature ? { feature } : {}),
            ...(projectInvariants.length > 0 ? { projectInvariantsChecked: projectInvariants.length } : {})
          })
        );
      } catch (e) {
        return errorText(
          e instanceof WalkStepNotFoundError ? e.message : `Simulation failed: ${(e as Error).message}`
        );
      }
    }
  );
};
