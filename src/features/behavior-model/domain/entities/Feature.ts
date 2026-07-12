import type { DevContext } from '../value-objects/DevContext';
import type { FeatureId } from '../value-objects/ids';
import type { AcceptanceCriterion } from './AcceptanceCriterion';
import type { Constant } from './Constant';
import type { Dependency } from './Dependency';
import type { Entity } from './Entity';
import type { EventDefinition } from './EventDefinition';
import type { Invariant } from './Invariant';
import type { Persona } from './Persona';
import type { ReachabilityGoal } from './ReachabilityGoal';
import type { Resource } from './Resource';
import type { Surface } from './Surface';
import type { ValueSet } from './ValueSet';
import type { Tag } from '$shared/domain/Tags';

export type Feature = {
  readonly id: FeatureId;
  readonly name: string;
  readonly description?: string;
  readonly tags?: readonly Tag[];
  readonly surfaces: readonly Surface[];
  readonly personas: readonly Persona[];
  readonly resources: readonly Resource[];
  readonly entities: readonly Entity[];
  /**
   * External systems the feature calls out to: services, datastores, queues,
   * devices, humans, filesystems. Distinct from `resources` (where DATA lives);
   * a Dependency captures the OPERATIONS the feature invokes and their contract
   * (timeout, retries, idempotency) and failure modes — the boundary logic that
   * otherwise stays implicit in code. Optional and additive; downstream code
   * reads `feature.dependencies ?? []`.
   */
  readonly dependencies?: readonly Dependency[];
  /**
   * Named, reusable enum value sets. A StateDefinition or Parameter of type
   * `enum` can reference one by id (`valueSetId`) instead of inlining its own
   * `enumValues`, so the allowed values live in one place. Optional and purely
   * additive: fields may still inline `enumValues`; unset means "no shared
   * value sets declared". Downstream code reads `feature.valueSets ?? []`.
   */
  readonly valueSets?: readonly ValueSet[];
  /**
   * Named constants referenced from expressions via `{ kind: 'const', name }`.
   * A threshold declared once here instead of copy-pasted into every rule /
   * invariant / derived formula that compares against it, so the number can't
   * drift across the spec (or against the code constant that implements it).
   * Optional and additive; downstream code reads `feature.constants ?? []`.
   */
  readonly constants?: readonly Constant[];
  /**
   * Cross-surface invariants. Checked after EVERY action runs, regardless
   * of which surface the action lives on. Use for accounting equations
   * (Σ balances = 0), global referential integrity, and other properties
   * that aren't tied to a single surface. Surface-local invariants stay
   * on the surface; declare here only when the check must hold globally.
   */
  readonly featureInvariants?: readonly Invariant[];
  /**
   * Liveness / reachability goals checked by the model checker against the
   * reachable state space: "this target state is reachable" (`reachable`) and
   * "the target stays reachable from everywhere" (`always_reachable`). The
   * complement to featureInvariants (safety) — goals assert something good is
   * achievable rather than something bad never happening. Optional and additive;
   * downstream code reads `feature.reachabilityGoals ?? []`.
   */
  readonly reachabilityGoals?: readonly ReachabilityGoal[];
  /**
   * Prose acceptance criteria (Given/When/Then) — the spec/documentation facet,
   * the complement to the model-checked action-level Scenario. Feature-level,
   * like reachabilityGoals. Optional and additive; downstream code reads
   * `feature.acceptanceCriteria ?? []`. Not model-checked (free-text prose), so
   * it never affects maturity/verification scores.
   */
  readonly acceptanceCriteria?: readonly AcceptanceCriterion[];
  /**
   * Registered events with optional payload schemas. Actions still
   * declare `emittedEvents: EventName[]` and emit_event effects still fire
   * by name. This list lets the dashboard show "this event name has a
   * documented payload" and lets the validator flag emissions that don't
   * resolve to any registered event. Optional for backward compatibility:
   * unset means "no payload schemas declared yet"; downstream code reads
   * `feature.events ?? []`.
   */
  readonly events?: readonly EventDefinition[];
  /**
   * Optional. When present, the MCP server treats focused reads as a
   * "developer mode" exchange. It injects implementation guidance and a
   * tag-audit spec so the LLM writing the prototype follows the team's
   * stack/conventions and tags emitted events traceably.
   */
  readonly devContext?: DevContext;
  /**
   * Actions the author/LLM commits to before modeling
   * (e.g. ["filter results", "detail view", "export to CSV"]). Used by
   * spec-depth diagnostics: every entry without a matching Action
   * surfaces as a critical gap.
   */
  readonly expectedActions?: readonly string[];
  /**
   * Explicit scope fence. Things the feature deliberately will NOT do
   * (e.g. ["No auth", "No backend persistence"]). Lets reviewers tell
   * "deliberately missing" apart from "shallow spec".
   */
  readonly nonGoals?: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
};
