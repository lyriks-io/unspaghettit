import { z } from 'zod';
import {
  addRuleToCapability,
  addRuleToSurface,
  removeRuleFromCapability,
  removeRuleFromSurface,
  updateRuleOnCapability,
  updateRuleOnSurface
} from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import { EntityNotFoundInFeatureError } from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import type { Rule } from '../../src/features/behavior-model/domain/entities/Rule';
import { ALL_RULE_CATEGORIES } from '../../src/features/behavior-model/domain/value-objects/RuleCategory';
import type { RuleCategory } from '../../src/features/behavior-model/domain/value-objects/RuleCategory';
import {
  asActionId,
  asEffectId,
  asFeatureId,
  asRuleId,
  asSurfaceId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import { runMutation, type ToolDeps } from './_shared';

const ruleCategorySchema = z.enum(
  ALL_RULE_CATEGORIES as unknown as [RuleCategory, ...RuleCategory[]]
);

const ruleSchemaDescription =
  '{ category, condition?, effect:{..., description}, description }. Rule and nested effect descriptions are mandatory. condition is OPTIONAL (omit it to make the rule fire unconditionally, useful for "always run this side-effect when the action fires"). The leaf key is `operator` and its value MUST come from the enum below — `op`, `eq` and `neq` are a DIFFERENT vocabulary (a host UI\'s visibility gates) and are rejected here. Otherwise condition is either { left, operator: equals|not_equals|greater_than|greater_or_equal|lower_than|lower_or_equal|contains|is_true|is_false|exists|does_not_exist, right? } (the leaf form; greater_or_equal/lower_or_equal are ≥/≤ — use them instead of off-by-one tricks like `greater_than 19` to mean `≥20`) OR a composite { kind: "all"|"any", conditions: [...] } / { kind: "not", condition: {...} } that combines other conditions, OR a quantifier over an array-typed state path: { kind: "all_match"|"any_match", overPath: "dotted.array.path", as: "item", where: {...condition...} } — all_match holds when EVERY element satisfies `where`, any_match when at least one does. The body binds each element under `as`, so it reads `item` (scalar arrays) or `item.field` (object arrays) and may also reference outer state paths. Use for per-element invariants like "every order line has qty>0": { kind:"all_match", overPath:"order.lines", as:"line", where:{ left:"line.qty", operator:"greater_than", right:0 } }. Vacuous: all_match over an empty/missing array is true, any_match is false. condition.left is normally a state-path string, but on ACTION rules only it may also be { kind:"param", name:"paramName" } to branch on a caller parameter without an intermediate set_state. Surface rules have no parameter scope and reject param-left at validation. condition.right accepts a raw literal OR a structured Expression for state-vs-state, state-vs-parameter, and arithmetic comparisons. Expression AST (discriminated by `kind`): { kind:"literal", value } | { kind:"state", path:"dotted.path" } | { kind:"param", name:"paramName" } | { kind:"add"|"sub"|"mul"|"div"|"mod"|"min"|"max", left:Expression, right:Expression } | { kind:"neg"|"not", operand:Expression }. Example state-on-left: condition:{ left:"player.lapsCompleted", operator:"greater_than", right:{ kind:"state", path:"match.lapsToWin" } } expresses "player.lapsCompleted > match.lapsToWin" honestly. Example param-on-left (action rule): condition:{ left:{ kind:"param", name:"quantity" }, operator:"greater_than", right:10 } fires when the caller passes quantity>10 with no state write required. Similarly, effect.value on set_state accepts the same Expression form.';

// The full effect vocabulary the simulator executes (EffectApplier). A rule's
// effect is a full Effect, so it must accept the same 10 types add_effect does —
// including the list mutations and advance_time — not the 6-type subset this
// list used to be, which silently blocked a conditional append_to_list /
// advance_time rule authored through the granular tools.
const KNOWN_EFFECT_TYPES = [
  'set_state',
  'show_message',
  'emit_event',
  'block_action',
  'allow_action',
  'transition_surface',
  'append_to_list',
  'remove_from_list',
  'update_list_item',
  'advance_time',
  'invoke_operation'
] as const;

const ruleInputSchema = z
  .object({
    category: ruleCategorySchema,
    condition: z.record(z.string(), z.unknown()).optional(),
    effect: z.record(z.string(), z.unknown()),
    description: z.string().min(1)
  })
  .superRefine((rule, ctx) => {
    if (
      typeof rule.effect.description !== 'string' ||
      rule.effect.description.trim().length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['effect', 'description'],
        message: 'Rule effect description is required'
      });
    }
    // Match effect.ts: refuse rules whose nested effect has an unknown
    // type. The simulator would crash later with a baffling "Cannot read
    // properties of undefined (reading 'blocked')". Common slip:
    // {type:"block"} for what should be {type:"block_action"}.
    const effectType = (rule.effect as { type?: unknown }).type;
    if (
      typeof effectType !== 'string' ||
      !(KNOWN_EFFECT_TYPES as readonly string[]).includes(effectType)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['effect', 'type'],
        message: `Rule effect.type must be one of ${KNOWN_EFFECT_TYPES.join(', ')} (got ${JSON.stringify(effectType)})`
      });
    }
  })
  .describe(ruleSchemaDescription);

type RuleInput = z.infer<typeof ruleInputSchema>;

const buildRule = (ids: () => string, input: RuleInput): Rule => ({
  id: asRuleId(ids()),
  category: input.category,
  ...(input.condition !== undefined
    ? { condition: input.condition as unknown as Rule['condition'] }
    : {}),
  effect: {
    ...(input.effect as object),
    id: asEffectId(((input.effect as { id?: string }).id ?? ids()))
  } as unknown as Rule['effect'],
  description: input.description
});

export const registerRuleTools = (deps: ToolDeps): void => {
  const { server, ids } = deps;

  // ─── Action rules ──────────────────────────────────────────────────────

  server.registerTool(
    'add_action_rule',
    {
      description: 'Append Rule to Action. Categories: business, security, permissions, compliance, validation, data, ux_feedback, error_handling, async, collaboration, billing_quota, audit. Use one of {security, permissions, compliance} to satisfy the "permissions" maturity check on data-mutating actions (anything with a set_state effect). Use validation for input-shape gates.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        actionId: z.string(),
        rule: ruleInputSchema
      }
    },
    async ({ featureId, surfaceId, actionId, rule }) => {
      const built = buildRule(ids, rule);
      return runMutation(
        deps,
        {
          featureId: asFeatureId(featureId),
          transform: (exp) =>
            addRuleToCapability(
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
    'update_action_rule',
    {
      description: 'Patch Rule fields (any of category/condition/effect/description). Id preserved.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        actionId: z.string(),
        ruleId: z.string(),
        patch: z
          .object({
            category: ruleCategorySchema.optional(),
            condition: z.record(z.string(), z.unknown()).optional(),
            effect: z.record(z.string(), z.unknown()).optional(),
            description: z.string().min(1).optional()
          })
          .describe('Partial Rule. Effect id is preserved when patching effect; new id minted if missing.')
      }
    },
    async ({ featureId, surfaceId, actionId, ruleId, patch }) =>
      runMutation(
        deps,
        {
          featureId: asFeatureId(featureId),
          transform: (exp) => {
            const surface = exp.surfaces.find((s) => s.id === asSurfaceId(surfaceId));
            const cap = surface?.actions.find((c) => c.id === asActionId(actionId));
            const existing = cap?.rules.find((r) => r.id === asRuleId(ruleId));
            if (!existing) throw new EntityNotFoundInFeatureError('rule', ruleId);
            const merged: Rule = {
              ...existing,
              ...(patch.category !== undefined ? { category: patch.category } : {}),
              ...(patch.condition !== undefined
                ? { condition: patch.condition as unknown as Rule['condition'] }
                : {}),
              ...(patch.effect !== undefined
                ? {
                    effect: {
                      ...(patch.effect as object),
                      id: asEffectId(((patch.effect as { id?: string }).id ?? existing.effect.id))
                    } as unknown as Rule['effect']
                  }
                : {}),
              ...(patch.description !== undefined ? { description: patch.description } : {})
            };
            return updateRuleOnCapability(
              exp,
              asSurfaceId(surfaceId),
              asActionId(actionId),
              merged
            );
          }
        },
        {
          scenarioScope: { surfaceId: asSurfaceId(surfaceId), actionId: asActionId(actionId) }
        }
      )
  );

  server.registerTool(
    'remove_action_rule',
    {
      description: 'Delete Rule from Action.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        actionId: z.string(),
        ruleId: z.string()
      }
    },
    async ({ featureId, surfaceId, actionId, ruleId }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) =>
          removeRuleFromCapability(
            exp,
            asSurfaceId(surfaceId),
            asActionId(actionId),
            asRuleId(ruleId)
          )
      })
  );

  // ─── Surface rules ─────────────────────────────────────────────────────────

  server.registerTool(
    'add_surface_rule',
    {
      description: 'Append surface-level Rule. Evaluated before action rules. Use for cross-cutting (auth gate, kill-switch). Same categories as add_action_rule; {security, permissions, compliance} are the "sensitive" set that the maturity scorer credits for data-mutating actions.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        rule: ruleInputSchema
      }
    },
    async ({ featureId, surfaceId, rule }) => {
      const built = buildRule(ids, rule);
      return runMutation(
        deps,
        {
          featureId: asFeatureId(featureId),
          transform: (exp) => addRuleToSurface(exp, asSurfaceId(surfaceId), built)
        },
        { createdId: built.id, scenarioScope: { surfaceId: asSurfaceId(surfaceId) } }
      );
    }
  );

  server.registerTool(
    'update_surface_rule',
    {
      description: 'Patch surface-level Rule fields. Id preserved.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        ruleId: z.string(),
        patch: z
          .object({
            category: ruleCategorySchema.optional(),
            condition: z.record(z.string(), z.unknown()).optional(),
            effect: z.record(z.string(), z.unknown()).optional(),
            description: z.string().min(1).optional()
          })
          .describe('Partial Rule. Effect id preserved when patching effect.')
      }
    },
    async ({ featureId, surfaceId, ruleId, patch }) =>
      runMutation(
        deps,
        {
          featureId: asFeatureId(featureId),
          transform: (exp) => {
            const surface = exp.surfaces.find((s) => s.id === asSurfaceId(surfaceId));
            const existing = surface?.rules.find((r) => r.id === asRuleId(ruleId));
            if (!existing) throw new EntityNotFoundInFeatureError('rule', ruleId);
            const merged: Rule = {
              ...existing,
              ...(patch.category !== undefined ? { category: patch.category } : {}),
              ...(patch.condition !== undefined
                ? { condition: patch.condition as unknown as Rule['condition'] }
                : {}),
              ...(patch.effect !== undefined
                ? {
                    effect: {
                      ...(patch.effect as object),
                      id: asEffectId(((patch.effect as { id?: string }).id ?? existing.effect.id))
                    } as unknown as Rule['effect']
                  }
                : {}),
              ...(patch.description !== undefined ? { description: patch.description } : {})
            };
            return updateRuleOnSurface(exp, asSurfaceId(surfaceId), merged);
          }
        },
        { scenarioScope: { surfaceId: asSurfaceId(surfaceId) } }
      )
  );

  server.registerTool(
    'remove_surface_rule',
    {
      description: 'Delete surface-level Rule.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        ruleId: z.string()
      }
    },
    async ({ featureId, surfaceId, ruleId }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) =>
          removeRuleFromSurface(exp, asSurfaceId(surfaceId), asRuleId(ruleId))
      })
  );
};
