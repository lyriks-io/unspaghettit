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
import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import { asFeatureId } from '../../src/features/behavior-model/domain/value-objects/ids';
import { applyOps } from './batch-ops/applyOps';
import type { Op } from './batch-ops/opHelpers';
import { errorText, text, type ToolDeps } from './_shared';
import { expandFeatureId } from './short-ids';
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
  readonly expiresAt: number;
};
const commitCache = new Map<string, PendingCommit>();
const pruneExpiredCommits = (now: number): void => {
  for (const [token, entry] of commitCache) {
    if (entry.expiresAt < now) commitCache.delete(token);
  }
};

const opSchemaDescription = `Each op: { kind, ref?, ...kindArgs }. ADD ops mint a new id and (when op.ref is set) remember it so later ops in the same batch can address it via *Ref strings. UPDATE ops take the existing id and a patch. REMOVE ops take the id. MOVE ops take { direction: "up"|"down" }. Full per-op-kind schema in the unspa://operations resource. Load it once before authoring a batch. Common gotcha: add_resource's resource entity has its own "kind" field which collides with the op-kind discriminator. Nest under "resource:{kind,...}" or pass "resourceKind" on the flat form.`;

export const registerBatchTool = (deps: ToolDeps): void => {
  const { server, repo, clock, ids, repoContext } = deps;

  server.registerTool(
    'apply_batch',
    {
      description:
        'Apply N add/update/remove/move ops to one Feature in a single atomic load+validate+save. Pass dryRun:true to validate and score without saving. The default dryRun response is a slim summary (~1 KB), pair with verbose:true ONLY when you need the full per-issue maturity report and post-batch feature. A valid dryRun also returns a `commitToken`: call apply_batch again with just { commit: token } (no operations) to save that batch without resending the ops — the server re-loads the feature and re-validates before saving, and tokens are single-use, expiring after 5 minutes. Add ops can capture their new id under `ref` so later ops use *Ref instead of *Id; sharedWith also accepts refs created earlier in the same batch. Strongly preferred over many granular calls. See the unspa://operations resource for the full per-op-kind schema reference.',
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
        const { next, refs, mintIdToOp } = applyOps(current, ops, ids);
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
        const saved: Feature = { ...next, updatedAt: clock() };
        await repo.save(saved);
        const codegen = maybeAutoGenerateTypes(saved, repoContext);
        return text({
          ok: true,
          featureId: saved.id,
          updatedAt: saved.updatedAt,
          appliedCount: ops.length,
          refs,
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
