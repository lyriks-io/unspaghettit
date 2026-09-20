import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  FeatureNotFoundError,
  FeatureValidationError
} from '../../src/features/behavior-model/application/use-cases/MutateFeature';
import {
  introducedValidationErrors,
  type ValidationResult
} from '../../src/features/behavior-model/domain/services/FeatureValidator';
import { scoreFeature } from '../../src/features/maturity/domain/MaturityScorer';
import { scoreFeatureTool } from '../../src/features/mcp-tools/application/tools/scoreFeature';
import {
  batchScenariosTool,
  type BatchScenarios
} from '../../src/features/mcp-tools/application/tools/batchScenarios';
import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import { asFeatureId } from '../../src/features/behavior-model/domain/value-objects/ids';
import { stampElementVersions } from '../../src/features/behavior-model/domain/services/FeatureElementVersions';
import {
  recordingIdGenerator,
  replayingIdGenerator
} from '../../src/shared/domain/IdGenerator';
import { applyOps } from './batch-ops/applyOps';
import type { Op } from './batch-ops/opHelpers';
import { errorText, loadProjectSiblings, text, type ToolDeps } from './_shared';
import { collectFeatureEntityIds, expandFeatureId } from './short-ids';
import { maybeAutoGenerateTypes } from './_codegen';

// A valid `dryRun` caches its (featureId, operations) under a one-shot token so
// the caller can commit later with just { commit } instead of resending the
// whole batch. Module-level so the cache survives across tool calls (the tool is
// registered once per server). Entries are pruned on expiry; the TTL is short
// because the intent is "dry-run, glance, commit", not durable storage.
const COMMIT_TTL_MINUTES = 5;
const COMMIT_TTL_MS = COMMIT_TTL_MINUTES * 60 * 1000;
type PendingCommit = {
  readonly featureId: string;
  readonly operations: readonly Op[];
  // The ids the dry run minted, in mint order. The commit replays them so the
  // `refs` the caller already recorded (evidence, links) name what gets saved.
  readonly mintedIds: readonly string[];
  readonly expiresAt: number;
};
const commitCache = new Map<string, PendingCommit>();
const pruneExpiredCommits = (now: number): void => {
  for (const [token, entry] of commitCache) {
    if (entry.expiresAt < now) commitCache.delete(token);
  }
};

type ScenarioReport =
  | { readonly scenarios: BatchScenarios }
  | { readonly scenariosError: string };

const hasScenarios = (feature: Feature): boolean =>
  feature.surfaces.some((s) => s.actions.some((a) => (a.scenarios ?? []).length > 0));

/**
 * The `scenarios` block of a batch answer. Siblings are loaded only when the
 * feature authors a scenario at all (they let an event cascade into another
 * feature, exactly as run_all_scenarios does), so a batch on a feature without
 * scenarios pays nothing for this.
 */
const scenariosOfBatch = async (
  before: Feature,
  after: Feature,
  loadSiblings: () => Promise<readonly Feature[] | undefined>
): Promise<ScenarioReport> => {
  try {
    const siblings = hasScenarios(after) ? await loadSiblings() : undefined;
    return { scenarios: batchScenariosTool(before, after, siblings) };
  } catch (e) {
    return {
      scenariosError: `The scenario run could not complete: ${(e as Error).message}. The batch itself is judged by \`validation\` alone; run run_all_scenarios for details.`
    };
  }
};

const opSchemaDescription = `Each op: { kind, ref?, ...kindArgs }. ADD ops mint a new id and (when op.ref is set) remember it so later ops in the same batch can address it via *Ref strings. UPDATE ops take the existing id and a patch. REMOVE ops take the id. MOVE ops take { direction: "up"|"down" }. Full per-op-kind schema in the unspa://operations resource. Load it once before authoring a batch. Common gotcha: add_resource's resource entity has its own "kind" field which collides with the op-kind discriminator. Nest under "resource:{kind,...}" or pass "resourceKind" on the flat form.`;

export const registerBatchTool = (deps: ToolDeps): void => {
  const { server, repo, projectRepo, clock, ids, repoContext } = deps;

  server.registerTool(
    'apply_batch',
    {
      description:
        'Apply N add/update/remove/move ops to one Feature in a single atomic load+validate+save. Pass dryRun:true to validate and score without saving. Every successful answer (dry run, direct apply, commit by token) carries `scenarios: { scope, run, passed, failed[], truncated? }`: the scenarios of what the batch touched, run on the post-batch feature, so a dry run already says whether an expected value still holds. scope is "touched" when the batch stayed inside actions (an action it added or updated, or whose rule, effect, parameter, invariant, transition or scenario it added, updated, removed or moved): only the scenarios exercising those actions run, the ones testing them plus the multi-step ones replaying them. scope is "feature" when the batch touched anything wider (a state definition, a surface or feature invariant, a surface rule, a constant, a value set, a persona, an event, an entity, an event handler): every scenario runs. `failed` lists failing scenarios only ({ scenarioId, name, surfaceId, actionId, actionName, expectedStatus, actualStatus, firstFailingStep?, reason }); passing ones are the `passed` count. At most 300 scenarios run, in model order, and `truncated:true` says the cap was hit (finish with run_all_scenarios). A failing scenario NEVER rejects the batch, validation alone decides that: read `scenarios.failed` before committing. The default dryRun response is a slim summary (~1 KB), pair with verbose:true ONLY when you need the full per-issue maturity report and post-batch feature. A valid dryRun also returns a `commitToken`: call apply_batch again with just { commit: token } (no operations) to save that batch without resending the ops — the server re-loads the feature and re-validates before saving, and tokens are single-use, expiring after 5 minutes. A committed token keeps the ids of its dry run: the `refs` it returns are the ones the dry run returned (an id the feature gained in between is the only one re-minted). Add ops can capture their new id under `ref` so later ops use *Ref instead of *Id; sharedWith also accepts refs created earlier in the same batch. Strongly preferred over many granular calls. See the unspa://operations resource for the full per-op-kind schema reference.',
      inputSchema: {
        featureId: z.string().optional(),
        dryRun: z.boolean().optional(),
        verbose: z.boolean().optional(),
        commit: z
          .string()
          .optional()
          .describe(
            'Commit token from a prior valid dryRun. Pass WITHOUT operations to save that batch: the server re-loads the feature, re-applies + re-validates the cached ops, then saves. Single-use; expires after 5 minutes.'
          ),
        operations: z
          .array(z.record(z.string(), z.unknown()))
          .optional()
          .describe(opSchemaDescription)
      }
    },
    async ({ featureId, operations, dryRun, verbose, commit }) => {
      try {
        // Resolve the ops + target feature. Two entry paths:
        //  - normal: caller passes { featureId, operations }.
        //  - commit: caller passes { commit } (a token from a prior valid
        //    dryRun) and no operations — replay the cached ops against the
        //    CURRENT feature (never blind-save a stale precomputed result).
        let ops: readonly Op[];
        let committing = false;
        let dryRunIds: readonly string[] = [];
        if (commit !== undefined) {
          const cached = commitCache.get(commit);
          commitCache.delete(commit); // one-shot: consume regardless of outcome
          if (!cached || cached.expiresAt < Date.now()) {
            return errorText(
              `Unknown or expired commitToken. Commit tokens are single-use and expire after ${COMMIT_TTL_MINUTES} minutes. Re-run apply_batch with dryRun:true to get a fresh token, then commit it.`
            );
          }
          featureId = cached.featureId;
          ops = cached.operations;
          dryRunIds = cached.mintedIds;
          committing = true;
        } else {
          if (!operations) {
            return errorText(
              'apply_batch requires `operations`, or a `commit` token from a prior dryRun.'
            );
          }
          if (!featureId) {
            return errorText('apply_batch requires `featureId` when passing `operations`.');
          }
          featureId = await expandFeatureId(repo, featureId);
          ops = operations as readonly Op[];
        }
        const current = await repo.get(asFeatureId(featureId));
        if (!current) throw new FeatureNotFoundError(featureId);
        // A commit mints the dry run's ids again, slot for slot. The feature is
        // reloaded, so an id it has gained since then is skipped for a fresh one
        // instead of colliding; past the recording the live generator takes over.
        const presentIds = committing ? collectFeatureEntityIds(current) : null;
        const recorder = recordingIdGenerator(
          presentIds ? replayingIdGenerator(dryRunIds, ids, (id) => presentIds.has(id)) : ids
        );
        const { next, refs, mintIdToOp, removedIdToOp } = applyOps(current, ops, recorder.mint);
        // Diff-aware validation (structural + reference-integrity): a batch is
        // blocked only when it INTRODUCES a new error versus the loaded
        // snapshot. Pre-existing issues on a partially-built feature (e.g.
        // descriptions not filled in yet, a legacy dangling ref) stay editable
        // so an unrelated batch isn't held hostage by them; they remain visible
        // via get_spec_gaps / score_feature. Same gate the granular tools use.
        // Annotate each error with the op index that introduced the referenced
        // entity. Scans every minted id in the error string against the
        // mintIdToOp map and prepends `op[N] (kind):` to the match. Without this
        // the agent gets errors like "Action 7bfd0b83 invariant 2909e02b: ..."
        // with no way to know which op authored that action, forcing a
        // guess-and-check loop through the whole batch.
        const annotateError = (msg: string): string => {
          // Substring-scan the message for any id we minted during this
          // batch. Regex-by-format would have to know about every id flavor
          // (8-hex, UUID, test fixture's "test-id-N"). Direct membership
          // is format-agnostic and cheap given typical batch sizes.
          // Pick the HIGHEST op index among matches: validator errors often
          // include several ids ("Action X rule Y: ..."); the most recently
          // minted one is usually the proximate cause (the rule, not the
          // parent action the agent already knows is fine).
          let bestOpIdx = -1;
          for (const [mintedId, opIdx] of mintIdToOp) {
            if (msg.includes(mintedId) && opIdx > bestOpIdx) bestOpIdx = opIdx;
          }
          // Same scan for ids the batch REMOVED: "transition targets unknown
          // surface X" then reads as "op[N] (remove_surface): ...", telling
          // the agent which removal orphaned the reference instead of leaving
          // it to correlate ids across the whole batch by hand.
          for (const [removedId, opIdx] of removedIdToOp) {
            if (msg.includes(removedId) && opIdx > bestOpIdx) bestOpIdx = opIdx;
          }
          if (bestOpIdx < 0) return msg;
          const op = ops[bestOpIdx] as { kind?: string };
          return `op[${bestOpIdx}] (${op?.kind ?? 'unknown'}): ${msg}`;
        };
        const annotateErrors = (errs: readonly string[]): readonly string[] =>
          errs.map(annotateError);
        // Both `current` and `next` are at the same (un-normalized) level here,
        // so the diff reflects only what the ops changed.
        const introduced = introducedValidationErrors(current, next);
        const validation: ValidationResult =
          introduced.length === 0
            ? { valid: true }
            : { valid: false, errors: annotateErrors(introduced) };
        // The scenarios of what the batch touched, run on the feature the batch
        // produces. Computed before anything is saved, so the dry run, the
        // direct apply and the commit all answer it the same way. A failure is
        // information: it never blocks the batch, and neither does a run that
        // cannot complete (the answer then says why instead of a verdict).
        const scenarioReport = validation.valid
          ? await scenariosOfBatch(current, next, () =>
              loadProjectSiblings(repo, projectRepo, String(featureId))
            )
          : {};
        // dryRun (never while committing): validate + score, don't save. On a
        // valid dry-run, cache the ops under a fresh single-use token so the
        // caller can commit later with just { commit } and no operations.
        if (dryRun && !committing) {
          let commitToken: string | undefined;
          if (validation.valid) {
            const now = Date.now();
            pruneExpiredCommits(now);
            commitToken = randomUUID();
            commitCache.set(commitToken, {
              featureId,
              operations: ops,
              mintedIds: [...recorder.minted],
              expiresAt: now + COMMIT_TTL_MS
            });
          }
          if (verbose) {
            return text({
              ok: validation.valid,
              dryRun: true,
              verbose: true,
              featureId,
              appliedCount: ops.length,
              refs,
              validation,
              maturity: validation.valid ? scoreFeature(next) : null,
              ...scenarioReport,
              ...(commitToken ? { commitToken } : {})
            });
          }
          return text({
            ok: validation.valid,
            dryRun: true,
            featureId,
            appliedCount: ops.length,
            refs,
            validation,
            maturity: validation.valid ? scoreFeatureTool(next) : null,
            ...scenarioReport,
            ...(commitToken ? { commitToken } : {})
          });
        }
        if (!validation.valid) {
          // Return a structured result instead of throwing. Previously this
          // path raised FeatureValidationError which the catch block turned
          // into a flat error string, losing the `refs` map (so the agent
          // couldn't see what would have been minted) and the full per-issue
          // list. Returning `{ok:false, validation, refs}` mirrors the
          // dry-run failure shape so the agent can iterate without losing
          // context.
          return text({
            ok: false,
            featureId,
            appliedCount: 0,
            refs,
            validation,
            hint: committing
              ? 'The cached batch no longer applies cleanly to the current feature (it changed since the dry-run). Re-run apply_batch with dryRun:true to re-validate, then commit the fresh token.'
              : 'Validation failed. The batch was NOT applied. Inspect `validation.errors` for per-issue details and `refs` for the ids that would have been minted. Re-run with `dryRun: true` to iterate without committing.'
          });
        }
        // Stamp the elements this batch actually changed (see
        // FeatureElementVersions), so drift can name them instead of
        // implicating every audited entity of the feature.
        const now = clock();
        const saved: Feature = stampElementVersions(current, { ...next, updatedAt: now }, now);
        await repo.save(saved);
        const codegen = maybeAutoGenerateTypes(saved, repoContext);
        return text({
          ok: true,
          featureId: saved.id,
          updatedAt: saved.updatedAt,
          appliedCount: ops.length,
          refs,
          ...scenarioReport,
          ...(committing ? { committed: true } : {}),
          ...(codegen
            ? { generatedTypes: { outputPath: codegen.outputPath, stats: codegen.stats } }
            : {})
        });
      } catch (e) {
        if (e instanceof FeatureNotFoundError) return errorText(e.message);
        if (e instanceof FeatureValidationError) {
          return errorText(`${e.message}\n - ${e.errors.join('\n - ')}`);
        }
        return errorText(`Batch failed: ${(e as Error).message}`);
      }
    }
  );
};
