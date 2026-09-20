import { z } from 'zod';
import {
  addAcceptanceCriterion,
  removeAcceptanceCriterion,
  updateAcceptanceCriterion
} from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import type { AcceptanceCriterion } from '../../src/features/behavior-model/domain/entities/AcceptanceCriterion';
import { criterionStandingWarnings } from '../../src/features/behavior-model/domain/services/CriterionStanding';
import {
  asAcceptanceCriterionId,
  asFeatureId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import {
  buildAcceptanceCriterion as buildAcceptanceCriterionBody,
  buildAcceptanceCriterionPatch
} from './_entity_builders';
import { runMutation, type ToolDeps } from './_shared';

const criterionInputSchema = z
  .object({
    title: z.string().min(1),
    given: z.string().optional(),
    when: z.string().optional(),
    then: z.string().optional(),
    expectedOutcome: z.enum(['success', 'failure', 'blocked']).optional(),
    relatedSurfaceId: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(['active', 'superseded', 'draft']).optional(),
    relations: z
      .array(
        z.object({
          kind: z.enum(['supersedes', 'refines', 'exception_to']),
          criterionId: z.string().min(1),
          featureId: z.string().optional(),
          note: z.string().optional()
        })
      )
      .optional()
  })
  .describe(
    '{ title, given?, when?, then?, expectedOutcome?: "success" | "failure" | "blocked", relatedSurfaceId?, description?, status?: "active" | "superseded" | "draft", relations?: [{ kind: "supersedes" | "refines" | "exception_to", criterionId, featureId?, note? }] }. A PROSE acceptance test — the spec/documentation facet of a feature, the complement to the model-checked action-level Scenario. Feature-level, like reachabilityGoals; NOT attached to a single action and NOT model-checked (given/when/then are free text authored by a human). `title` is the only required field. `expectedOutcome` records whether the WHEN is meant to succeed, be rejected, or error out (defaults to "success"). `relatedSurfaceId` optionally links the criterion to a surface; a dangling link is tolerated, never validated. Use a Scenario (add_scenario) instead when you need a checkable assertion the simulator can prove. `status` says where the criterion stands (absent = active; a draft supersedes nothing yet). `relations` say what it supersedes, refines or is an exception to: `criterionId` must be a criterion of THIS feature unless `featureId` names another feature (then it is carried unresolved); no self relation, no duplicate (kind, criterionId). Statuses are never set for you: when a criterion supersedes another that is still active, the answer carries a `warnings` entry and the old one reads "active, but superseded by <ids>" until you mark it. Neither field affects maturity or any verification score.'
  );

type CriterionInput = z.infer<typeof criterionInputSchema>;

// Construction lives in _entity_builders.ts so this tool and the apply_batch op
// handler share one source of truth (the drift trap that bit other entities).
const buildCriterion = (ids: () => string, input: CriterionInput): AcceptanceCriterion =>
  buildAcceptanceCriterionBody(input as unknown as Record<string, unknown>, ids);

export const registerAcceptanceCriterionTools = (deps: ToolDeps): void => {
  const { server, ids } = deps;

  server.registerTool(
    'add_acceptance_criterion',
    {
      description:
        'Append a feature-level prose acceptance criterion (Given/When/Then + expected outcome): the documentation facet that complements the model-checked action-level Scenario. Rendered and searchable, carried in the model, but never simulated or scored. Use for edge cases a human writes in prose; use add_scenario when the check should be executable. Optional `status` (active | superseded | draft) and `relations` (supersedes | refines | exception_to another criterion) record how criteria replace one another; the answer carries `warnings` when a criterion is superseded while still marked active.',
      inputSchema: {
        featureId: z.string(),
        criterion: criterionInputSchema
      }
    },
    async ({ featureId, criterion }) => {
      const built = buildCriterion(ids, criterion);
      return runMutation(
        deps,
        {
          featureId: asFeatureId(featureId),
          transform: (exp) => addAcceptanceCriterion(exp, built)
        },
        { createdId: built.id, warn: criterionStandingWarnings }
      );
    }
  );

  server.registerTool(
    'update_acceptance_criterion',
    {
      description:
        "Patch an acceptance criterion's fields (title, given, when, then, expectedOutcome, relatedSurfaceId, description). Pass relatedSurfaceId:null to clear the surface link. Also patches status (active | superseded | draft; status:null clears it back to active) and relations (a full replacement; relations:[] clears them). The answer carries `warnings` when a criterion is superseded while still marked active.",
      inputSchema: {
        featureId: z.string(),
        criterionId: z.string(),
        patch: z.record(z.string(), z.unknown())
      }
    },
    async ({ featureId, criterionId, patch }) =>
      runMutation(
        deps,
        {
          featureId: asFeatureId(featureId),
          transform: (exp) =>
            updateAcceptanceCriterion(
              exp,
              asAcceptanceCriterionId(criterionId),
              buildAcceptanceCriterionPatch(patch as Record<string, unknown>)
            )
        },
        { warn: criterionStandingWarnings }
      )
  );

  server.registerTool(
    'remove_acceptance_criterion',
    {
      description: 'Delete a feature-level acceptance criterion.',
      inputSchema: {
        featureId: z.string(),
        criterionId: z.string()
      }
    },
    async ({ featureId, criterionId }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) => removeAcceptanceCriterion(exp, asAcceptanceCriterionId(criterionId))
      })
  );
};
