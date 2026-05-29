import type { Effect } from '../value-objects/Effect';
import type { EventName } from '../value-objects/EventName';
import type { ActionId } from '../value-objects/ids';
import type { StatePath } from '../value-objects/StatePath';
import type { Invariant } from './Invariant';
import type { Parameter } from './Parameter';
import type { Rule } from './Rule';
import type { Scenario } from './Scenario';
import type { Transition } from './Transition';

/**
 * Behavioral roles an action plays in the feature. Multi-valued
 * (an action can be both `primary` and `async`). Read by spec-depth
 * diagnostics to demand the right kind of coverage: an `async` action
 * needs loading/error scenarios; a `destructive` one needs a scenario
 * exercising its path; a `validation` one needs at least one blocking rule.
 */
export type ActionRole =
  | 'entry'
  | 'primary'
  | 'validation'
  | 'feedback'
  | 'destructive'
  | 'async'
  | 'persistence';

export const ALL_CAPABILITY_ROLES: readonly ActionRole[] = [
  'entry',
  'primary',
  'validation',
  'feedback',
  'destructive',
  'async',
  'persistence'
];

/**
 * Taxonomy for an Evolution proposal — what *kind* of improvement it is.
 * Drives iconography/filtering in the dashboard; never affects simulation.
 */
export type EvolutionCategory =
  | 'security'
  | 'competitor'
  | 'ux'
  | 'accessibility'
  | 'scale'
  | 'compliance'
  | 'other';

export const ALL_EVOLUTION_CATEGORIES: readonly EvolutionCategory[] = [
  'security',
  'competitor',
  'ux',
  'accessibility',
  'scale',
  'compliance',
  'other'
];

/**
 * Marks an Action as a proposed **Evolution** rather than committed behavior.
 *
 * Evolutions are contextual improvement suggestions the LLM raises proactively
 * while modeling ("competitors offer SSO", "harden the password reset flow") —
 * created as skeleton actions with an empty body (no rules/effects). They are
 * technically real (own an id, live in the spec, can be enqueued) but render
 * distinctly (dashed) and are EXCLUDED from maturity scoring and spec-gap
 * nagging so a proposal never drags the feature's score down or generates
 * "this action does nothing" noise. Accepting one = flesh it out and clear
 * this marker (or just `enqueue` it to implement later). Absent = a normal
 * committed action.
 */
export type Evolution = {
  /** The "because…" — why this is worth doing. Shown to the user. */
  readonly rationale: string;
  /** What kind of improvement this is. Optional; defaults to 'other' in UI. */
  readonly category?: EvolutionCategory;
  /** Optional provenance, e.g. "competitors", "OWASP ASVS", "WCAG 2.2". */
  readonly source?: string;
};

export type Action = {
  readonly id: ActionId;
  readonly name: string;
  readonly intent: string;
  readonly parameters: readonly Parameter[];
  readonly requiredStates: readonly StatePath[];
  readonly rules: readonly Rule[];
  readonly invariants: readonly Invariant[];
  /** Effects that fire when the action succeeds (no rule blocked). */
  readonly effects: readonly Effect[];
  /**
   * Effects that fire when the action is blocked by a rule. Useful for
   * universal fallbacks like "always redirect to /sign-in on a permission
   * block". State mutations (`set_state`) are still suppressed because the
   * action was rejected; transitions, events, and messages do fire.
   * Optional; treated as empty when absent.
   */
  readonly onBlockedEffects?: readonly Effect[];
  readonly emittedEvents: readonly EventName[];
  readonly transitions: readonly Transition[];
  /**
   * Test scenarios for this action. Named state setups that exercise
   * specific branches of its rules. Optional; treated as an empty array when
   * absent. Domain layer reads `scenarios ?? []`.
   */
  readonly scenarios?: readonly Scenario[];
  /**
   * Behavioral roles this action plays. Multi-valued. Drives spec-gap
   * diagnostics (e.g. `destructive` ⇒ requires a scenario; `async` ⇒
   * requires loading/error coverage). Optional; treated as `[]` when absent.
   */
  readonly roles?: readonly ActionRole[];
  /**
   * Escape hatch for repair / admin actions: when true, surface + action
   * + feature invariants are NOT checked after this action runs. Use ONLY
   * for actions that exist to recover from an already-broken invariant
   * (e.g. "Force Recompute Balances" when Σ != 0 has frozen every other
   * action via a feature invariant). The dashboard should mark these
   * conspicuously. Optional; treated as `false` when absent.
   */
  readonly bypassInvariants?: boolean;
  /**
   * Marks this action as an event handler. When ANY action in the feature
   * emits an event with this name (via an `emit_event` effect), this action
   * runs automatically as a cascade after the emitter's own effects apply.
   * The handler reads the post-emit snapshot and contributes its own
   * effects + invariant checks.
   *
   * Use for the "B reacts to A" pattern: Expense Ledger emits `expense.added`,
   * Group Setup's "Recount Expenses" handler is `triggeredByEvent:
   * "expense.added"` and increments `group.expenseCount`. Scenarios that
   * simulate A now also exercise B without needing a separate test.
   *
   * Handlers must NOT have required parameters (they receive no input from
   * the cascade, read state directly). The validator enforces this.
   * Cascading is bounded by a depth limit and a per-cascade cycle guard.
   */
  readonly triggeredByEvent?: EventName;
  /**
   * When present, this action is a proposed Evolution (a dashed-border
   * placeholder), not committed behavior. See {@link Evolution}. Optional;
   * absent means a normal action. Excluded from maturity + spec-gap analysis.
   */
  readonly evolution?: Evolution;
};

/**
 * True when the action is a proposed Evolution rather than committed behavior.
 * Single source of truth so maturity scoring, spec-gap diagnostics, and the
 * dashboard all agree on what counts as a dashed placeholder.
 */
export const isEvolution = (action: Action): boolean => action.evolution !== undefined;

/** The committed (non-proposal) actions on a surface. */
export const committedActions = <T extends { readonly evolution?: Evolution }>(
  actions: readonly T[]
): readonly T[] => actions.filter((a) => a.evolution === undefined);
