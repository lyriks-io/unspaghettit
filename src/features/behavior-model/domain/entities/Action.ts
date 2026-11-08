import type { ActionOutcome } from './ActionOutcome';
import type { Effect } from '../value-objects/Effect';
import type { EventName } from '../value-objects/EventName';
import type { ActionId, ExposureId, InvariantId } from '../value-objects/ids';
import type { RuleCondition } from '../value-objects/RuleCondition';
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
 * Who fires an action.
 *
 *  - `user`: a person does it (a tap, a form, a command). The default.
 *  - `system`: the product does it on its own (a sensor reading, a background
 *    job, a lifecycle hook). Nobody is looking at a screen when it runs.
 *  - `schedule`: time does it (a timer, a cron, a deadline passing).
 *  - `event`: something that happened does it. Usually a modeled event
 *    (`triggeredByEvent`), but the host product may also fire an action from an
 *    event this model does not describe, so the two are not tied together.
 *
 * It matters because several authoring checks assume a person: a blocked run
 * "should show a message" only if someone is there to read it.
 */
export type ActionActor = 'user' | 'system' | 'schedule' | 'event';

export const ALL_ACTION_ACTORS: readonly ActionActor[] = ['user', 'system', 'schedule', 'event'];

/**
 * A channel an action can be reached through from outside its own code.
 *
 *  - `ui`: a person reaches it on a screen of the product.
 *  - `api`: a program reaches it over the product's API (HTTP, RPC...).
 *  - `mcp`: an AI agent reaches it as a tool of the product's MCP server,
 *    remotely, with no screen in front of anyone.
 *  - `webmcp`: an AI agent reaches it as a tool the product's page exposes in
 *    the person's own browser session (WebMCP). The person is there and the
 *    agent acts with their session, which is why it is not `mcp`: consent and
 *    risk differ.
 *  - `cli`: someone reaches it from the product's command line.
 */
export type ExposureChannel = 'ui' | 'api' | 'mcp' | 'webmcp' | 'cli';

export const ALL_EXPOSURE_CHANNELS: readonly ExposureChannel[] = [
  'ui',
  'api',
  'mcp',
  'webmcp',
  'cli'
];

/**
 * The channel a call arrives through, read as a parameter of that call. It is an
 * input like any other, supplied by the runtime instead of the caller, so every
 * reader of parameters carries it unchanged: a rule reads it with
 * `{ kind: "param", name: "$channel" }`, a scenario or a simulation sets it
 * through its parameter values, the verification tries each offered channel.
 * The `$` keeps it apart from declared parameters (a Slack action may well have
 * its own `channel`). Absent means the call did not say, and runs as before.
 */
export const CALLER_CHANNEL_PARAM = '$channel';

/** The channels the action is offered on, once each, in vocabulary order. */
export const offeredChannels = (action: Pick<Action, 'exposures'>): readonly ExposureChannel[] =>
  ALL_EXPOSURE_CHANNELS.filter((c) =>
    (action.exposures ?? []).some((e) => e.channel === c && isOffered(e))
  );

/**
 * The parameter names a call to this action may carry: its declared parameters,
 * plus the caller channel once the action declares any exposure (a withheld one
 * included, so a scenario can prove the call is refused there). The one list
 * every scenario reader filters on, so the channel is never dropped by one.
 */
export const callableParameterNames = (
  action: Pick<Action, 'parameters' | 'exposures'>
): Set<string> => {
  const names = new Set(action.parameters.map((p) => p.name));
  if ((action.exposures ?? []).length > 0) names.add(CALLER_CHANNEL_PARAM);
  return names;
};

/** The withheld exposure of `channel` on this action, if the action is kept off it. */
export const withheldOn = (
  action: Pick<Action, 'exposures'>,
  channel: unknown
): ActionExposure | undefined =>
  (action.exposures ?? []).find((e) => e.channel === channel && e.withheld !== undefined);

/**
 * How an action is reachable on one channel, or that it is deliberately NOT.
 *
 * Kept light on purpose: the kernel records the channel and the name the channel
 * knows the action by, never a protocol contract. The contract (inputs, refusals,
 * answer) is the action itself; an authentication method or an API version
 * belongs to the endpoint that serves it, which the host product documents.
 *
 * A channel no exposure names is UNDECLARED, which is not a defect: an action
 * missing from the MCP server is incoherent only when something in the product
 * needs it there. A `withheld` exposure is the other kind of statement, a
 * decision ("delete is never offered to an agent"), so it carries its reason and
 * never an operation.
 */
export type ActionExposure = {
  readonly id: ExposureId;
  readonly channel: ExposureChannel;
  /**
   * The name the channel knows the action by, as its callers write it:
   * `PUT /issues/:id`, `update_issue`, `issue update`. Free text, one per
   * exposure; an action reachable under two routes carries two exposures.
   */
  readonly operation?: string;
  /** Present when the action is kept off this channel on purpose, with why. */
  readonly withheld?: { readonly reason: string };
};

/** Whether the exposure offers the action (as opposed to withholding it). */
export const isOffered = (exposure: Pick<ActionExposure, 'withheld'>): boolean =>
  exposure.withheld === undefined;

/**
 * The channels an action declares, split by what they say: offered or withheld.
 * Null when it declares none, so compact readers add nothing for the common
 * case. Channels come once each, in vocabulary order.
 */
export type ExposureSummary = {
  readonly offered: readonly ExposureChannel[];
  readonly withheld: readonly ExposureChannel[];
};

export const exposureSummary = (action: Pick<Action, 'exposures'>): ExposureSummary | null => {
  const exposures = action.exposures ?? [];
  if (exposures.length === 0) return null;
  const pick = (offered: boolean) =>
    ALL_EXPOSURE_CHANNELS.filter((c) =>
      exposures.some((e) => e.channel === c && isOffered(e) === offered)
    );
  return { offered: pick(true), withheld: pick(false) };
};

/** `{ exposures }` for a compact reader when the action declares any, else nothing. */
export const withExposures = (
  action: Pick<Action, 'exposures'>
): { readonly exposures?: ExposureSummary } => {
  const summary = exposureSummary(action);
  return summary ? { exposures: summary } : {};
};

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
  /**
   * Set when the user dismissed this proposal in Builder mode. The action
   * stays in the spec as a tombstone — still an Evolution (so it remains
   * excluded from maturity + spec-gap analysis) but hidden from the Builder
   * suggestions list. Its purpose is to tell the assistant "this idea was
   * already raised and rejected" so it proposes something *different* next
   * time instead of re-suggesting it. Absent on a live proposal.
   */
  readonly dismissed?: boolean;
};

/**
 * Scoped, auditable relaxation of specific invariants for a repair / admin
 * action — the safe replacement for the blunt {@link Action.bypassInvariants}
 * boolean. Instead of silently skipping EVERY post-flight invariant, the action
 * names exactly which invariants it may leave temporarily violated, why, and
 * (optionally) the condition that describes when the relaxation is legitimate
 * or recovery is complete.
 *
 * The simulator skips only the named invariants after this action runs; every
 * other feature / surface / action invariant is still enforced. Prefer this
 * over `bypassInvariants`, which relaxes everything with no rationale.
 */
export type InvariantRelaxation = {
  /** The specific invariants (by id) this action may leave temporarily violated. */
  readonly invariantIds: readonly InvariantId[];
  /** Why this action is allowed to relax them — surfaced in audits and reviews. */
  readonly rationale: string;
  /**
   * Optional condition describing when the relaxation is legitimate, or the
   * state a repair must restore. Documented for review and future verification;
   * not yet enforced by the simulator.
   */
  readonly recoveryCondition?: RuleCondition;
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
   *
   * Blunt: it relaxes EVERYTHING. Prefer {@link Action.invariantRelaxation},
   * which names only the invariants that may be relaxed and records why.
   */
  readonly bypassInvariants?: boolean;
  /**
   * Scoped invariant relaxation: the specific invariants this repair/admin
   * action may leave temporarily violated, with a rationale (and optional
   * recovery condition). The simulator skips ONLY these after the action runs;
   * every other invariant is still enforced. Preferred over the all-or-nothing
   * `bypassInvariants`. Optional; absent means no relaxation. If both are set,
   * `bypassInvariants` still wins (skips everything).
   */
  readonly invariantRelaxation?: InvariantRelaxation;
  /**
   * The terminal results this action can resolve to beyond success / blocked
   * (a decline, a timeout, a queued job, a partial completion). The simulator
   * picks the first outcome whose condition holds after the action's effects
   * apply and runs that outcome's effects. Optional and purely additive: with
   * no outcomes an action simply succeeds. See {@link ActionOutcome}.
   */
  readonly outcomes?: readonly ActionOutcome[];
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
   * Who fires this action. See {@link ActionActor}. Optional: absent means
   * `user`, except on an event handler (`triggeredByEvent` set), which reads as
   * `event`. Never read this field directly to decide behavior; go through
   * {@link effectiveActor} so every reader agrees on the derivation.
   */
  readonly actor?: ActionActor;
  /**
   * The channels this action is reachable through (ui, api, mcp, cli), or kept
   * off on purpose. See {@link ActionExposure}. Optional; absent means nothing
   * is declared, which no check reads as a gap.
   */
  readonly exposures?: readonly ActionExposure[];
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

/**
 * Who fires the action, once the defaults are applied: the declared `actor`
 * when there is one, else `event` for an event handler, else `user`. The ONE
 * place this is derived, so the maturity check, every read tool and the digest
 * cannot drift apart. A feature written before `actor` existed reads exactly as
 * it used to for a person-fired action, and its handlers now say `event`.
 */
export const effectiveActor = (
  action: Pick<Action, 'actor' | 'triggeredByEvent'>
): ActionActor =>
  action.actor ?? (action.triggeredByEvent !== undefined ? 'event' : 'user');

/** The committed (non-proposal) actions on a surface. */
export const committedActions = <T extends { readonly evolution?: Evolution }>(
  actions: readonly T[]
): readonly T[] => actions.filter((a) => a.evolution === undefined);
