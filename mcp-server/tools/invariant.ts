import { z } from 'zod';
import {
  addFeatureInvariant,
  addInvariantToCapability,
  addInvariantToSurface,
  removeFeatureInvariant,
  removeInvariantFromCapability,
  removeInvariantFromSurface,
  updateFeatureInvariant,
  updateInvariantOnCapability,
  updateInvariantOnSurface
} from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import type { Invariant } from '../../src/features/behavior-model/domain/entities/Invariant';
import {
  asActionId,
  asFeatureId,
  asInvariantId,
  asSurfaceId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import { buildInvariant as buildInvariantBody } from './_entity_builders';
import { runMutation, type ToolDeps } from './_shared';

const invariantInputSchema = z
  .object({
    name: z.string().min(1),
    condition: z.record(z.string(), z.unknown()),
    message: z.string().min(1),
    description: z.string().min(1)
  })
  .describe('{ name, condition: { left, operator, right? }, message, description }. The condition may also be a composite ({kind:"all"|"any"|"not"}) or a quantifier over an array-typed state path ({ kind:"all_match"|"any_match", overPath, as, where }) — e.g. the per-element invariant "every order line has qty>0": { kind:"all_match", overPath:"order.lines", as:"line", where:{ left:"line.qty", operator:"greater_than", right:0 } }. condition.left is normally a state-path string, but on ACTION invariants only it may also be { kind:"param", name:"paramName" } to assert against a caller parameter. Surface invariants and feature invariants have no parameter scope and reject param-left at validation. Semantics are inverted from rules: the condition must be TRUE for the invariant to HOLD. A FALSE condition is the violation, and a violation blocks the run. Phrase the condition as the always-true property (e.g. "amount greater_than 0", not "amount equals -1"). Never use a tautologically-false condition like equals to an impossible literal, it would block every action.');

type InvariantInput = z.infer<typeof invariantInputSchema>;

// Invariant construction lives in _entity_builders.ts so this tool and the
// apply_batch op handler share a single source of truth. Avoids the kind
// of drift that bit Scenario.expectedTransition.
const buildInvariant = (ids: () => string, input: InvariantInput): Invariant =>
  buildInvariantBody(input as unknown as Record<string, unknown>, ids);

export const registerInvariantTools = (deps: ToolDeps): void => {
  const { server, ids } = deps;

  // ─── Action invariants ─────────────────────────────────────────────────

  server.registerTool(
    'add_action_invariant',
    {
      description: 'Append Invariant scoped to an Action. Checked after the action runs.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        actionId: z.string(),
        invariant: invariantInputSchema
      }
    },
    async ({ featureId, surfaceId, actionId, invariant }) => {
      const built = buildInvariant(ids, invariant);
      return runMutation(
        deps,
        {
          featureId: asFeatureId(featureId),
          transform: (exp) =>
            addInvariantToCapability(
              exp,
              asSurfaceId(surfaceId),
              asActionId(actionId),
              built
            )
        },
        {
          createdId: built.id,
          scenarioScope: { surfaceId: asSurfaceId(surfaceId), actionId: asActionId(actionId) }
        }
      );
    }
  );

  server.registerTool(
    'update_action_invariant',
    {
      description: 'Patch action-level Invariant fields.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        actionId: z.string(),
        invariantId: z.string(),
        patch: z.record(z.string(), z.unknown())
      }
    },
    async ({ featureId, surfaceId, actionId, invariantId, patch }) =>
      runMutation(
        deps,
        {
          featureId: asFeatureId(featureId),
          transform: (exp) =>
            updateInvariantOnCapability(
              exp,
              asSurfaceId(surfaceId),
              asActionId(actionId),
              asInvariantId(invariantId),
              patch as Partial<Invariant>
            )
        },
        {
          scenarioScope: { surfaceId: asSurfaceId(surfaceId), actionId: asActionId(actionId) }
        }
      )
  );

  server.registerTool(
    'remove_action_invariant',
    {
      description: 'Delete action-level Invariant.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        actionId: z.string(),
        invariantId: z.string()
      }
    },
    async ({ featureId, surfaceId, actionId, invariantId }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) =>
          removeInvariantFromCapability(
            exp,
            asSurfaceId(surfaceId),
            asActionId(actionId),
            asInvariantId(invariantId)
          )
      })
  );

  // ─── Surface invariants ────────────────────────────────────────────────────

  server.registerTool(
    'add_surface_invariant',
    {
      description: 'Append surface-level Invariant. Checked after every action runs. Use for cross-cutting safety.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        invariant: invariantInputSchema
      }
    },
    async ({ featureId, surfaceId, invariant }) => {
      const built = buildInvariant(ids, invariant);
      return runMutation(
        deps,
        {
          featureId: asFeatureId(featureId),
          transform: (exp) => addInvariantToSurface(exp, asSurfaceId(surfaceId), built)
        },
        { createdId: built.id, scenarioScope: { surfaceId: asSurfaceId(surfaceId) } }
      );
    }
  );

  server.registerTool(
    'update_surface_invariant',
    {
      description: 'Patch surface-level Invariant fields.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        invariantId: z.string(),
        patch: z.record(z.string(), z.unknown())
      }
    },
    async ({ featureId, surfaceId, invariantId, patch }) =>
      runMutation(
        deps,
        {
          featureId: asFeatureId(featureId),
          transform: (exp) =>
            updateInvariantOnSurface(
              exp,
              asSurfaceId(surfaceId),
              asInvariantId(invariantId),
              patch as Partial<Invariant>
            )
        },
        { scenarioScope: { surfaceId: asSurfaceId(surfaceId) } }
      )
  );

  server.registerTool(
    'remove_surface_invariant',
    {
      description: 'Delete surface-level Invariant.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        invariantId: z.string()
      }
    },
    async ({ featureId, surfaceId, invariantId }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) =>
          removeInvariantFromSurface(
            exp,
            asSurfaceId(surfaceId),
            asInvariantId(invariantId)
          )
      })
  );

  // ─── Feature-level invariants ────────────────────────────────────────────
  // Cross-surface invariants checked after every action in the feature
  // regardless of which surface the action lives on. Use when a property
  // (accounting equation, global referential integrity) must hold globally.

  server.registerTool(
    'add_feature_invariant',
    {
      description:
        'Append a feature-level Invariant. Unlike surface invariants, this one is checked after EVERY action runs anywhere in the feature. Use for cross-surface properties like Σ(per-user balances) = 0. Cuts the previous workaround of duplicating the same invariant onto every surface.',
      inputSchema: {
        featureId: z.string(),
        invariant: invariantInputSchema
      }
    },
    async ({ featureId, invariant }) => {
      const built = buildInvariant(ids, invariant);
      return runMutation(
        deps,
        {
          featureId: asFeatureId(featureId),
          transform: (exp) => addFeatureInvariant(exp, built)
        },
        { createdId: built.id }
      );
    }
  );

  server.registerTool(
    'update_feature_invariant',
    {
      description: 'Patch a feature-level Invariant\'s fields.',
      inputSchema: {
        featureId: z.string(),
        invariantId: z.string(),
        patch: z.record(z.string(), z.unknown())
      }
    },
    async ({ featureId, invariantId, patch }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) =>
          updateFeatureInvariant(
            exp,
            asInvariantId(invariantId),
            patch as Partial<Invariant>
          )
      })
  );

  server.registerTool(
    'remove_feature_invariant',
    {
      description: 'Delete a feature-level Invariant.',
      inputSchema: {
        featureId: z.string(),
        invariantId: z.string()
      }
    },
    async ({ featureId, invariantId }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) =>
          removeFeatureInvariant(exp, asInvariantId(invariantId))
      })
  );
};
