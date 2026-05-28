import type { DevContext } from '../value-objects/DevContext';
import type { FeatureId } from '../value-objects/ids';
import type { Entity } from './Entity';
import type { EventDefinition } from './EventDefinition';
import type { Invariant } from './Invariant';
import type { Persona } from './Persona';
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
   * Named, reusable enum value sets. A StateDefinition or Parameter of type
   * `enum` can reference one by id (`valueSetId`) instead of inlining its own
   * `enumValues`, so the allowed values live in one place. Optional and purely
   * additive: fields may still inline `enumValues`; unset means "no shared
   * value sets declared". Downstream code reads `feature.valueSets ?? []`.
   */
  readonly valueSets?: readonly ValueSet[];
  /**
   * Cross-surface invariants. Checked after EVERY action runs, regardless
   * of which surface the action lives on. Use for accounting equations
   * (Σ balances = 0), global referential integrity, and other properties
   * that aren't tied to a single surface. Surface-local invariants stay
   * on the surface; declare here only when the check must hold globally.
   */
  readonly featureInvariants?: readonly Invariant[];
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
