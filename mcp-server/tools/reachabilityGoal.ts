import { z } from 'zod';
import {
  addReachabilityGoal,
  removeReachabilityGoal,
  updateReachabilityGoal
} from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import type { ReachabilityGoal } from '../../src/features/behavior-model/domain/entities/ReachabilityGoal';
import {
  asFeatureId,
  asReachabilityGoalId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import { buildReachabilityGoal as buildReachabilityGoalBody } from './_entity_builders';
import { runMutation, type ToolDeps } from './_shared';

const goalInputSchema = z
  .object({
    name: z.string().min(1),
    kind: z.enum(['reachable', 'always_reachable']),
    condition: z.record(z.string(), z.unknown()),
    description: z.string().min(1),
    message: z.string().min(1).optional()
  })
  .describe(
    '{ name, kind: "reachable" | "always_reachable", condition: { left, operator, right? }, description, message? }. A LIVENESS goal — the complement to an invariant (safety). kind "reachable": some reachable state satisfies the condition (the target is achievable at all — catches an impossible goal like an order status that can never be reached). kind "always_reachable": from EVERY reachable state the target stays reachable (catches a flow that can get permanently stuck short of it). condition is the target state, phrased as the property that holds there (e.g. { left: "order.status", operator: "equals", right: "delivered" }); same composite/quantifier forms as invariants. Feature-level: no parameter scope. Evaluated by model_check / verify over the reachable state space, so it is BOUNDED — a clean result means "within N steps", not a proof.'
  );

type GoalInput = z.infer<typeof goalInputSchema>;

// Construction lives in _entity_builders.ts so this tool and the apply_batch op
// handler share one source of truth (the drift trap that bit other entities).
const buildGoal = (ids: () => string, input: GoalInput): ReachabilityGoal =>
  buildReachabilityGoalBody(input as unknown as Record<string, unknown>, ids);

export const registerReachabilityGoalTools = (deps: ToolDeps): void => {
  const { server, ids } = deps;

  server.registerTool(
    'add_reachability_goal',
    {
      description:
        'Append a feature-level reachability/liveness goal: assert that a target state is achievable ("reachable") or stays achievable from everywhere ("always_reachable"). The complement to invariants — invariants say nothing bad ever happens, goals say something good can still happen. model_check and verify evaluate goals over the reachable state space and return a counterexample path for an always_reachable trap.',
      inputSchema: {
        featureId: z.string(),
        goal: goalInputSchema
      }
    },
    async ({ featureId, goal }) => {
      const built = buildGoal(ids, goal);
      return runMutation(
        deps,
        {
          featureId: asFeatureId(featureId),
          transform: (exp) => addReachabilityGoal(exp, built)
        },
        { createdId: built.id }
      );
    }
  );

  server.registerTool(
    'update_reachability_goal',
    {
      description: "Patch a reachability goal's fields (name, kind, condition, message, description).",
      inputSchema: {
        featureId: z.string(),
        goalId: z.string(),
        patch: z.record(z.string(), z.unknown())
      }
    },
    async ({ featureId, goalId, patch }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) =>
          updateReachabilityGoal(
            exp,
            asReachabilityGoalId(goalId),
            patch as Partial<ReachabilityGoal>
          )
      })
  );

  server.registerTool(
    'remove_reachability_goal',
    {
      description: 'Delete a feature-level reachability goal.',
      inputSchema: {
        featureId: z.string(),
        goalId: z.string()
      }
    },
    async ({ featureId, goalId }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) => removeReachabilityGoal(exp, asReachabilityGoalId(goalId))
      })
  );
};
