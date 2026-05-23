import { z } from 'zod';
import {
  addScenarioToCapability,
  removeScenarioFromCapability,
  updateScenarioOnCapability
} from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import type { Scenario } from '../../src/features/behavior-model/domain/entities/Scenario';
import {
  asActionId,
  asFeatureId,
  asScenarioId,
  asSurfaceId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import { buildScenario, buildScenarioPatch } from './_entity_builders';
import { runMutation, type ToolDeps } from './_shared';

const stateOverrideSchema = z.object({
  path: z.string(),
  value: z.unknown()
});

const parameterOverrideSchema = z.object({
  parameterName: z.string(),
  value: z.unknown()
});

const assertionOperatorSchema = z.enum([
  'equals',
  'not_equals',
  'greater_than',
  'lower_than',
  'contains',
  'is_true',
  'is_false',
  'exists',
  'does_not_exist'
] as const);

const expectedAssertionSchema = z.object({
  path: z.string(),
  operator: assertionOperatorSchema,
  value: z.unknown().optional(),
  description: z.string().min(1)
});

const expectedStatusSchema = z.enum(['success', 'blocked'] as const);

export const registerScenarioTools = (deps: ToolDeps): void => {
  const { server, ids } = deps;

  server.registerTool(
    'add_scenario',
    {
      description:
        'Add a state preset for one Action (exercises a rule branch). Optional personaId supplies the user baseline; scenario overrides layer after persona overrides. expectedStatus, expectedAssertions[], and expectedTransition make the scenario executable. `run_all_scenarios` will mark a fail when actual status / any post-simulation assertion / the transition target drifts. Assertion `value` accepts a literal or an Expression (see rule schema). `expectedTransition` should be the target surfaceId (or null to assert "no transition fires"). Use it to verify routing / wizard / state-machine actions.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        actionId: z.string(),
        name: z.string().min(1),
        description: z.string().min(1),
        personaId: z.string().optional(),
        stateOverrides: z.array(stateOverrideSchema).default([]),
        parameterOverrides: z.array(parameterOverrideSchema).default([]),
        expectedStatus: expectedStatusSchema.optional(),
        expectedAssertions: z.array(expectedAssertionSchema).optional(),
        expectedTransition: z.string().nullable().optional()
      }
    },
    async (input) => {
      // Single source of truth: the builder maps the wire shape to the
      // typed entity. Keeping this thin avoids drift with the apply_batch
      // op handler in batch.ts (which calls the same builder).
      const scenario = buildScenario(input as unknown as Record<string, unknown>, ids);
      return runMutation(
        deps,
        {
          featureId: asFeatureId(input.featureId),
          transform: (exp) =>
            addScenarioToCapability(
              exp,
              asSurfaceId(input.surfaceId),
              asActionId(input.actionId),
              scenario
            )
        },
        { createdId: scenario.id }
      );
    }
  );

  server.registerTool(
    'update_scenario',
    {
      description:
        'Patch Scenario fields. personaId sets the persona baseline; personaId:null clears it. expectedAssertions:[] clears assertions; expectedStatus omitted means "keep current"; expectedTransition can be a surfaceId, null (asserts no transition), or omitted (keep current). Run run_all_scenarios after editing to confirm the spec still holds.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        actionId: z.string(),
        scenarioId: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().min(1).optional(),
        personaId: z.string().nullable().optional(),
        stateOverrides: z.array(stateOverrideSchema).optional(),
        parameterOverrides: z.array(parameterOverrideSchema).optional(),
        expectedStatus: expectedStatusSchema.optional(),
        expectedAssertions: z.array(expectedAssertionSchema).optional(),
        expectedTransition: z.string().nullable().optional()
      }
    },
    async (input) => {
      const patch: Partial<Scenario> = buildScenarioPatch(
        input as unknown as Record<string, unknown>
      );
      return runMutation(deps, {
        featureId: asFeatureId(input.featureId),
        transform: (exp) =>
          updateScenarioOnCapability(
            exp,
            asSurfaceId(input.surfaceId),
            asActionId(input.actionId),
            asScenarioId(input.scenarioId),
            patch
          )
      });
    }
  );

  server.registerTool(
    'remove_scenario',
    {
      description: 'Delete Scenario.',
      inputSchema: {
        featureId: z.string(),
        surfaceId: z.string(),
        actionId: z.string(),
        scenarioId: z.string()
      }
    },
    async ({ featureId, surfaceId, actionId, scenarioId }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) =>
          removeScenarioFromCapability(
            exp,
            asSurfaceId(surfaceId),
            asActionId(actionId),
            asScenarioId(scenarioId)
          )
      })
  );
};
