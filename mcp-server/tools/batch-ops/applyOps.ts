import type { Feature } from '../../../src/features/behavior-model/domain/entities/Feature';
import { applyFeatureLevelOps } from './featureLevelOps';
import { applyRuleInvariantOps } from './ruleInvariantOps';
import { applyScenarioEventOps } from './scenarioEventOps';
import { applyStateParamOps } from './stateParamOps';
import { applySurfaceActionOps } from './surfaceActionOps';
import type { Op, OpContext, Refs } from './opHelpers';

// Family handlers, chained in the same order the original single switch
// tested op kinds. Each handler returns the next Feature when it recognized
// op.kind and null when the op belongs to another family, so an op falls
// through the chain until exactly one family claims it.
const familyHandlers: readonly ((op: Op, ctx: OpContext) => Feature | null)[] = [
  applySurfaceActionOps,
  applyStateParamOps,
  applyRuleInvariantOps,
  applyFeatureLevelOps,
  applyScenarioEventOps
];

/**
 * Walk the ops list once, folding each op into the running feature.
 * `add_*` ops capture the new id under op.ref (if provided) so subsequent
 * ops can address it via `*Ref` instead of `*Id`. Throws on the first
 * malformed op so the caller sees exactly which one broke.
 *
 * Also returns `mintIdToOp`: a map from every server-minted id to the index
 * of the op that produced it. The apply_batch caller uses this to annotate
 * validation errors (which reference entity ids like "Action 7bfd0b83") with
 * the op index that introduced them, so the agent knows exactly which op
 * to fix rather than scanning the whole batch.
 */
export const applyOps = (start: Feature, ops: readonly Op[], rawMintId: () => string): {
  next: Feature;
  refs: Refs;
  mintIdToOp: ReadonlyMap<string, number>;
} => {
  let exp = start;
  const refs: Refs = {};
  const mintIdToOp = new Map<string, number>();
  const remember = (ref: unknown, id: string) => {
    if (typeof ref === 'string' && ref.length > 0) refs[ref] = id;
  };

  let currentOpIndex = -1;
  // Shadow the raw mintId with a tracking variant for the rest of the
  // function. Every minted id gets recorded with the index of the op that
  // produced it so apply_batch can attribute validation errors back to a
  // specific op number.
  const mintId = (): string => {
    const id = rawMintId();
    if (currentOpIndex >= 0) mintIdToOp.set(id, currentOpIndex);
    return id;
  };

  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i]!;
    currentOpIndex = i;
    try {
      const ctx: OpContext = { feature: exp, refs, mintId, remember };
      let handled: Feature | null = null;
      for (const handler of familyHandlers) {
        handled = handler(op, ctx);
        if (handled !== null) break;
      }
      if (handled === null) throw new Error(`unknown op kind "${op.kind}"`);
      exp = handled;
    } catch (e) {
      throw new Error(`op[${i}] (${op.kind}): ${(e as Error).message}`);
    }
  }

  return { next: exp, refs, mintIdToOp };
};
