import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { text } from '../tools/_shared';

export const OPERATIONS_REFERENCE = `# apply_batch operations reference

Each op: \`{ kind, ref?, ...kindArgs }\`. Add ops capture their new id under \`op.ref\`
so later ops in the same batch can use \`*Ref\` strings instead of raw \`*Id\` values.

Descriptions are mandatory for every authored behavior element. That includes
features, projects, surfaces, state definitions, parameters, rules, effects,
invariants, transitions, personas, resources, entities, entity fields, scenarios,
scenario assertions, events, and event payload fields. Actions use \`intent\` as
their mandatory description field.

**\`*Ref\` vs \`*Id\` rule.** Use \`*Ref\` (e.g. \`surfaceRef\`, \`actionRef\`) ONLY to reference
something minted earlier in the SAME batch via \`op.ref\`. Refs do not survive across
batches. To reference an entity that already exists (returned by a previous call,
\`list_feature_ids\`, etc.), use the raw \`*Id\` field (\`surfaceId\`, \`actionId\`, …).
Mixing them in one op is allowed: e.g. \`add_scenario { surfaceId: existing-uuid,
actionRef: a_new }\` works when only the action was minted in this batch.

## ADD ops

  add_surface              { ref?, name, type, description, parentRef?|parentSurfaceId? }
  add_action           { ref?, surfaceRef|surfaceId, name, intent, requiredStates?, emittedEvents?, bypassInvariants?, invariantRelaxation?, triggeredByEvent?, evolution? }
. \`requiredStates\` is \`string[]\` of state paths declared on (or shared into) the action's surface - NOT condition objects. Use rules / invariants for value-level constraints.
. \`invariantRelaxation: { invariantIds:[...], rationale, recoveryCondition? }\` is the scoped, preferred escape hatch for a repair/admin action: the simulator skips ONLY the named invariants after it runs, every other invariant is still enforced. Prefer it over \`bypassInvariants:true\`, which relaxes everything with no rationale. On update_action pass \`invariantRelaxation:null\` to clear it.
. \`evolution: { rationale, category?, source? }\` marks the action as a proposed Evolution (dashed placeholder; excluded from maturity / spec-gaps until accepted). Prefer the \`propose_evolution\` tool. On update_action pass \`evolution:null\` to accept (clear the marker).
. Subscribe an action to an event with \`triggeredByEvent:"event.name"\`. When ANY action in the feature emits that event, the simulator runs this action as a cascaded handler against the post-emit snapshot. Bounded by depth limit (8) and per-cascade cycle guard. Handlers must not have required parameters without defaults.
  add_action_outcome   { ref?, surfaceRef|surfaceId, actionRef|actionId, name, outcomeKind, condition?, effects?, description? }
. First-class outcome: the terminal result an action resolves to BEYOND success/blocked (a decline, a timeout, a queued job, a partial batch). \`outcomeKind\` is one of success|rejected|failure|timeout|cancelled|partial|pending (named \`outcomeKind\`, NOT \`kind\`, because \`kind\` is the op discriminator). \`condition\` is a RuleCondition that selects it — the simulator picks the FIRST outcome whose condition holds after the action's effects apply, and a condition-less outcome is the catch-all default. \`effects\` (same shape as add_effect's \`effect\`, ids minted for you) run when the outcome is selected. Status stays success/blocked; the resolved outcome rides in the simulation result. \`remove_action_outcome { surfaceRef|surfaceId, actionRef|actionId, outcomeId }\`.
  add_state_definition     { ref?, surfaceRef|surfaceId, path, type, defaultValue, enumValues?, valueSetId?, description, sharedWith? }
. \`type\` is string | number | boolean | enum | object | array. Common synonyms are folded to the canonical type: int/integer → number (so a counter with type:"int", defaultValue:0 is fine), bool → boolean, str/text → string.
  add_parameter            { ref?, surfaceRef|surfaceId, actionRef|actionId, name, type, required, description, enumValues?, valueSetId?, defaultValue?, bindToStatePath?, validations?, resourceId? }
. For \`type:"enum"\`, supply EITHER inline \`enumValues\` OR \`valueSetId\` (a feature-level value set from add_value_set) - not both. valueSetId lets several states/params share one editable list. \`bindToStatePath\` must name a state path declared on (or shared into) the action's surface. \`resourceId\` links the param to a feature Resource for compliance/provenance (does not affect simulation).
. \`validations\` is an array of tagged checks that fire before any rules. Tags: { type:"non_empty"|"email"|"url"|"uuid"|"ipv4"|"ipv6"|"hex"|"base64"|"slug"|"phone_e164"|"color_hex"|"semver"|"json"|"iso_date"|"iso_datetime"|"iso_time"|"alphanumeric"|"alphabetic"|"lowercase"|"uppercase"|"no_whitespace"|"integer"|"positive"|"negative"|"non_negative"|"non_positive"|"finite"|"safe_integer" } for the no-arg checks, OR { type:"min_length"|"max_length"|"length"|"min"|"max"|"multiple_of", value:N } / { type:"pattern"|"starts_with"|"ends_with"|"contains", value:"..." }. All accept an optional \`message:"..."\` override.
  add_action_rule      { ref?, surfaceRef|surfaceId, actionRef|actionId, rule: { category, condition?, effect:{type,..., description}, description } }
. \`category\` enum: business | security | permissions | compliance | validation | data | ux_feedback | error_handling | async | collaboration | billing_quota | audit. Not "blocking" - pick the closest semantic.
. \`effect.type\` enum: set_state | show_message | emit_event | block_action | allow_action | transition_surface | append_to_list | remove_from_list | update_list_item | advance_time | invoke_operation (a rule effect can be any of the 11, same as add_effect). \`invoke_operation{dependencyId,operation,resultPath?,resultValue?}\` calls an operation on a feature Dependency and writes the modeled result to resultPath (like set_state) so rules/outcomes can branch on it. To block an action, use \`{type:"block_action", reason:"...", description:"..."}\` - NOT \`{type:"block",...}\`. Unknown effect types are rejected at validation; if you see "unknown effect.type" in the response, fix the spelling.
. \`condition.left\` is normally a state-path string. On ACTION rules and ACTION invariants only, it may also be \`{kind:"param", name:"paramName"}\` to branch on a caller parameter without an intermediate set_state. Surface rules, surface invariants, and feature invariants have no parameter scope and reject param-left at validation. Other Expression shapes (\`{kind:"state",...}\`, \`{kind:"add",...}\`, etc.) are NOT accepted on the left; only \`condition.right\` takes those.
  add_surface_rule         { ref?, surfaceRef|surfaceId, rule }
  add_effect               { ref?, surfaceRef|surfaceId, actionRef|actionId, effect, onBlocked? }
. Same effect.type enum as above (all 11). transition_surface accepts \`targetRef\` for surfaces minted earlier in the same batch. \`onBlocked:true\` appends to the action's onBlockedEffects (the fallback the simulator runs when the action is BLOCKED - state writes suppressed, but transition_surface/emit_event/show_message still fire) instead of the success-path effects. update_effect / remove_effect take the same \`onBlocked\` flag to target that list.
  add_action_invariant { ref?, surfaceRef|surfaceId, actionRef|actionId, invariant: { name, condition, message, description } }
. Inverted from rules: condition TRUE = invariant HOLDS; condition FALSE = VIOLATION (and a violation blocks the run). Phrase the condition as the always-true property.
  add_surface_invariant    { ref?, surfaceRef|surfaceId, invariant: { name, condition, message, description } }
  add_feature_invariant    { ref?, invariant: { name, condition, message, description } }
. Feature-level invariants are checked after every action in the feature regardless of surface. Use for cross-surface properties (Σ balances = 0). Eliminates the workaround of duplicating one invariant onto every surface.
. An invariant has EXACTLY ONE condition and it must ALWAYS hold — there is no second field for a consequent. \`mustHold\`/\`then\`/\`implies\` do not exist and are REJECTED (they used to be silently dropped, which inverted the invariant into "the antecedent must always be true"). Write an implication "A implies B" as condition: { kind:"any", conditions:[ { kind:"not", condition:A }, B ] }. Example — "a downloaded album implies a paid plan": { kind:"any", conditions:[ { kind:"not", condition:{ left:"album.downloaded", operator:"is_true" } }, { left:"user.plan", operator:"not_equals", right:"free" } ] }.
  add_reachability_goal    { ref?, goal: { name, kind, condition, description, message? } }
. NEST the goal body under \`goal\` - its own \`kind\` ("reachable" | "always_reachable") collides with the op-kind discriminator \`kind:"add_reachability_goal"\`, and a JSON object cannot carry two \`kind\` keys, so a flat \`{ kind:"add_reachability_goal", ..., kind:"reachable" }\` silently loses the op kind. (Same collision pattern as add_resource / add_dependency.) Feature-level LIVENESS goal, the complement to invariants (safety). \`goal.kind:"reachable"\` = some reachable state satisfies \`condition\` (the target is achievable at all); \`goal.kind:"always_reachable"\` = the target stays reachable from EVERY reachable state (no trap). \`condition\` is the target state, same shape as an invariant condition; no parameter scope. Evaluated by model_check / verify over the reachable state space (bounded), which return the shortest action path to a trap on an always_reachable failure.
  add_acceptance_criterion { ref?, title, given?, when?, then?, expectedOutcome?, relatedSurfaceId?, description? }
. Feature-level PROSE acceptance test (Given/When/Then), the documentation facet that complements the model-checked action-level Scenario. \`title\` is the only required field; \`expectedOutcome\` is success|failure|blocked (defaults success); \`relatedSurfaceId\` is an optional, unvalidated link. NOT simulated, model-checked, or scored — use add_scenario when you need a checkable assertion. \`update_acceptance_criterion { criterionId, patch }\` (patch relatedSurfaceId:null clears the link); \`remove_acceptance_criterion { criterionId }\`.
  add_transition           { ref?, surfaceRef|surfaceId, target|targetRef, label?, description, actionRef?|actionId? }
. Surface-scoped by default. Pass actionRef|actionId to attach the edge to that action's transitions[] instead (a declarative diagram/coverage edge; the routing the simulator RUNS is the transition_surface effect). update_transition / remove_transition take the same actionRef|actionId.
  add_persona              { ref?, name, description, stateOverrides?, parameterOverrides?, persistAcrossSurfaces? }
  add_value_set            { ref?, name, description, values }
. A named, reusable enum (\`values\` is a non-empty string[]). States/params of type "enum" reference it via \`valueSetId\` so the allowed values live in one place; edit them once via update_value_set.
  add_constant             { ref?, name, description, value }
. A named feature-level constant (\`value\` is any scalar or array). Expressions reference it via \`{kind:"const", name}\` (a condition.right, set_state.value, derived formula, invariant threshold) so a threshold/cutoff lives in one place instead of copy-pasted literals. \`name\` is the reference key, unique within the feature; edit the value once via update_constant.
  add_resource             { ref?, resource: { name, kind, provider, scope, sensitivity, containsPii, accessMode, ... } }
. The resource's own \`kind\` collides with the op-kind discriminator. Nest under \`resource:{kind,...}\` (preferred) or pass \`resourceKind\` on the flat form.
  add_dependency           { ref?, name, dependencyKind, description?, provider?, operations?, assumptions? }
. An external system the feature calls out to (service | database | queue | device | human | filesystem | api | other), distinct from a resource (where DATA lives). \`dependencyKind\` (NOT \`kind\`, the op discriminator) is the kind. \`operations\` is \`[{ name, description?, failureModes?:[...], timeout?, retries?, idempotent? }]\` — the calls an action makes, with their contract. get_spec_gaps flags an operation with no timeout or no failure modes. \`remove_dependency { dependencyId }\`.
  add_entity                 { ref?, namespace, fields, description, resourceRef?|resourceId? }
  add_entity_field           { ref?, dataRef|entityId, name, type, ... }
  link_project_definition    { kind: "entity"|"resource"|"persona", id }
. Make this feature REFERENCE a definition in the owning project's canonical library instead of carrying its own copy. Idempotent. The definition is resolved into feature.entities/resources/personas on every read, so verify / model_check / run_all_scenarios / digests / the dashboard all see it as if it were local, while it stays stored ONCE. Get real ids from list_project_library; use promote_to_project_library to move an existing inline copy into the library (and collapse identical copies in sibling features). A ref the project can't satisfy is a per-feature validation error, never a silent drop.
  unlink_project_definition  { kind: "entity"|"resource"|"persona", id }
. Drops the ref AND the resolved copy, so the feature doesn't silently keep an inline duplicate. Use to clear a dangling ref.
  add_scenario             { ref?, surfaceRef|surfaceId, actionRef|actionId, name, description, personaId?|personaRef?, stateOverrides?, parameterOverrides?, expectedStatus?, expectedAssertions?, expectedTransition?|expectedTransitionRef?, steps? }
. \`parameterOverrides\` items are \`{parameterName, value}\` - must match a declared parameter on the target action (NOT parameterId, NOT name). \`stateOverrides\` items are \`{path, value}\`. \`expectedAssertions\` items are \`{path, operator, value, description}\` - NOT the rule-condition \`{left, operator, right}\` shape: \`path\` is the state path (a string), \`value\` is the comparison operand, and \`description\` is REQUIRED. Omitting \`path\` (or misnaming it \`left\`) surfaces as the confusing "Scenario assertion for 'undefined' is missing a description" - the real fix is to use \`path\`/\`value\` and add a \`description\`. \`expectedStatus\` enum: \`"success"\` | \`"blocked"\` (NOT "ok"). \`expectedTransition\` is the target surfaceId, or null to assert "no transition fires", or omitted to skip the check. If you author expectedAssertions but the action gets blocked, the scenario FAILS - set expectedStatus:"blocked" if the block is intentional.
. \`steps\` makes the scenario multi-step: an ordered array of \`{actionId, surfaceId?, parameterOverrides?, expectedStatus?, expectedAssertions?, description?}\` REPLAYED before the subject action (each a real simulate, threading state forward). The subject action's stateOverrides set the INITIAL snapshot. A step defaults to expectedStatus:"success"; a step that blocks unexpectedly fails the whole scenario. Use for flows: add to cart -> apply coupon -> checkout.
  add_event                { ref?, name, description, payloadSchema?, delivery? }
. \`delivery\` is the handler guarantee: best_effort (default, a failing handler never touches the emitter), required (a failing handler blocks the emitting action), or transactional (a failing handler also rolls the emitter's state back). Lets you model "the command was accepted but a mandatory downstream update failed" instead of a silent success.

## UPDATE ops

  update_surface              { surfaceRef|surfaceId, name?, type?, description?, parentSurfaceId? }
  update_action           { surfaceRef|surfaceId, actionRef|actionId, name?, intent?, requiredStates?, emittedEvents? }
  update_state_definition     { surfaceRef|surfaceId, stateDefinitionId, ...partial, sharedWith? }
  update_parameter            { surfaceRef|surfaceId, actionRef|actionId, parameterId, ...partial }
  update_action_rule      { surfaceRef|surfaceId, actionRef|actionId, ruleId, patch }
  update_surface_rule         { surfaceRef|surfaceId, ruleId, patch }
  update_effect               { surfaceRef|surfaceId, actionRef|actionId, effectId, patch }
  update_action_invariant { ..., invariantId, patch }
  update_surface_invariant    { surfaceRef|surfaceId, invariantId, patch }
  update_feature_invariant    { invariantId, patch }
  update_reachability_goal    { goalId, patch }
  update_transition           { surfaceRef|surfaceId, transitionId, target?, label?, description? }
  update_persona              { personaId, ...partial }
  update_value_set            { valueSetId, name?, description?, values? }
. \`values\` is a full replacement. On update_state_definition / update_parameter, \`valueSetId:null\` clears the reference (back to inline enumValues or no enum).
  update_constant             { constantId, name?, description?, value? }
. Editing \`value\` is the single source of truth for every \`{kind:"const"}\` reference. Renaming \`name\` re-keys it, so any expression still using the old name becomes a dangling reference (validator flags it) - rename the references in the same batch.
  update_resource             { resourceId, resource?:{ ...partial }, resourceKind?, ...partial }
. Same kind-collision rule as add_resource.
  update_entity                 { entityId, ...partial }
  update_entity_field           { dataRef|entityId, fieldId, patch }
  update_scenario             { ..., scenarioId, ...partial, personaId?|personaRef?|null, expectedStatus?, expectedAssertions?, expectedTransition?|expectedTransitionRef? }
  update_event                { eventId, ...partial }

## REMOVE ops

  remove_<kind> { ...ids/refs }. Every add_ has a matching remove_.

## MOVE ops (direction: "up" | "down")

  move_surface         { surfaceRef|surfaceId, direction }
  move_action      { surfaceRef|surfaceId, actionRef|actionId, direction }
  move_parameter       { ..., parameterId, direction }
  move_state_definition{ ..., stateDefinitionId, direction }

## Tips

- IDs are opaque server-minted strings. Never invent them. Use refs in the same batch
  or values read from list_*/get_* calls.
- \`condition.right\` and \`set_state.value\` accept either a raw literal OR a structured
  Expression: { kind:"literal"|"state"|"param"|"add"|"sub"|"mul"|"div"|"mod"|"min"|"max"|"neg"|"not"|"sum"|"count"|"sum_pluck"|"count_where"|"switch", ... }.
  \`not\` flips a boolean operand, use it for toggle effects (\`set_state value:{kind:"not", operand:{kind:"state", path:"x.isPublic"}}\`)
  instead of two condition-based rules, which would re-trigger on the value they just wrote.
  \`sum\` and \`count\` reduce an array operand. \`{kind:"sum", operand:{kind:"state", path:"shares"}}\` returns the running total of a numeric array;
  combined with \`sub\` and \`equals\`, it expresses "Σ shares = amount" as one rule: condition:{ left:"amount", operator:"equals", right:{kind:"sum", operand:{kind:"state", path:"shares"}} }.
  Non-array operands (or arrays with non-numeric items for sum) return undefined, comparing against undefined is always false, so the rule won't fire silently.
  \`sum_pluck\` and \`count_where\` operate on arrays of objects. \`{kind:"sum_pluck", operand:{kind:"state", path:"shares"}, field:"amount"}\` sums the \`amount\` field of each object in the shares array.
  \`{kind:"count_where", operand:{kind:"state", path:"applications"}, field:"status", equals:{kind:"literal", value:"enrolled"}}\` counts applications whose status field equals "enrolled".
  \`switch\` is the declarative case/branch primitive: \`{kind:"switch", cases:[{when: RuleCondition, then: Expression}, ...], default: Expression}\`. The first case whose condition holds wins; falls through to \`default\` if none match.
  Use for "enroll if seats available else waitlist" patterns that would otherwise need 4 rules: \`set_state path:"application.status" value:{kind:"switch", cases:[{when:{left:"enrolledCount", operator:"lower_than", right:{kind:"state", path:"capacity"}}, then:{kind:"literal", value:"enrolled"}}], default:{kind:"literal", value:"waitlisted"}}\`.
- \`lower_than\` / \`greater_than\` (and their inclusive forms \`lower_or_equal\` / \`greater_or_equal\`,
  i.e. ≤ / ≥) compare numbers AND ISO 8601 date strings (lexicographic order matches
  chronological order). Mix doesn't compare: both operands must be the same kind. Prefer the
  inclusive forms over off-by-one literals (write \`greater_or_equal 20\`, not \`greater_than 19\`).
- Rule \`condition\` is OPTIONAL. Omit it for an "always fires" rule, useful for
  unconditional side effects like resetting stale per-mode state when a Set Mode action
  runs. Invariants still require a condition (an unconditional invariant is vacuous).
- A condition can be a leaf comparison \`{ left, operator, right? }\` OR a composite
  \`{ kind:"all"|"any", conditions:[...] }\` / \`{ kind:"not", condition:{...} }\` that
  combines other conditions. So one rule expresses "block when mode='weighted' AND total != 100"
  via \`condition:{ kind:"all", conditions:[ {left:"mode",operator:"equals",right:"weighted"}, {left:"total",operator:"not_equals",right:100} ] }\`
  instead of two flat rules that share an effect. Implication \`A → B\` is \`{kind:"any", conditions:[{kind:"not", condition: A}, B]}\`.
- Pass \`dryRun: true\` on apply_batch to validate + score without saving. Add \`verbose: true\`
  to get the full per-issue maturity report; otherwise the response is a slim summary (~1 KB).

Evaluation semantics (matters for scenario assertions and rule ordering):
- Effects apply SEQUENTIALLY in the order written, and derived (computed) state is
  recomputed after EACH one. A rule's condition therefore reads the state left by every
  earlier rule/effect in the same run, not the pre-action snapshot. Order your rules so a
  guard sees the value it expects.
- Surface rules run before action rules; if any rule's effect is a \`block_action\`, later
  effects (and the action's own effects) are suppressed. \`onBlockedEffects\` still fire on a
  block, but \`set_state\` among them is dropped (the action was rejected) while transitions,
  events, and messages go through.
- Assert on the POST-run state: a scenario's \`expectedAssertions\` see \`result.finalState\`
  after all effects + derived recomputation, and after any \`emit_event\` cascade
  (\`triggeredByEvent\` handlers) has settled.`;

// Op signature lines in the reference look like "  add_surface  { ref?, ... }";
// the notes that document an op start with ". " on the following lines.
const OP_LINE_RE = /^\s{2,}([a-z_]+)\s+\{/;
const NOTE_LINE_RE = /^\.\s/;

/** Every op kind that has a dedicated signature line in the reference, sorted. */
export const knownOpKinds = (): readonly string[] => {
  const kinds: string[] = [];
  for (const line of OPERATIONS_REFERENCE.split('\n')) {
    const m = OP_LINE_RE.exec(line);
    if (m) kinds.push(m[1]!);
  }
  return [...new Set(kinds)].sort();
};

/**
 * The signature line for `kind` plus its trailing note lines, or undefined when
 * the kind has no dedicated entry (e.g. every `remove_*`, which the reference
 * collapses into one generic line). Lets `describe_operations` hand back just
 * the slice an author needs instead of the whole resource.
 */
export const describeOpKind = (kind: string): string | undefined => {
  const lines = OPERATIONS_REFERENCE.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = OP_LINE_RE.exec(lines[i]!);
    if (!m || m[1] !== kind) continue;
    const out = [lines[i]!.trim()];
    for (let j = i + 1; j < lines.length && NOTE_LINE_RE.test(lines[j]!); j++) {
      out.push(lines[j]!.trim());
    }
    return out.join('\n');
  }
  return undefined;
};

export const registerOperationsResource = (server: McpServer): void => {
  server.registerResource(
    'operations',
    'unspa://operations',
    {
      title: 'apply_batch operations reference',
      description:
        'Full per-op-kind schema reference for apply_batch. Every add/update/remove/move op with its required + optional fields. Load this once when you need to plan a batch; the apply_batch tool description carries only a one-line pointer to keep tool listings small.',
      mimeType: 'text/plain'
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/plain',
          text: OPERATIONS_REFERENCE
        }
      ]
    })
  );

  // Companion tool: pull the schema for ONE op kind (or the kind list) without
  // loading the whole unspa://operations resource. Registered here since it
  // reads the same reference the resource serves.
  server.registerTool(
    'describe_operations',
    {
      description:
        'Return the apply_batch op schema for ONE op kind, or the list of known kinds when none is given, so you can pull just what you need instead of loading the whole unspa://operations resource. Example: { kind: "add_surface" } returns that op\'s signature and notes.',
      inputSchema: { kind: z.string().optional() }
    },
    async ({ kind }) => {
      if (!kind) {
        return text({
          kinds: knownOpKinds(),
          hint: 'Pass one of these as `kind`, or read the full unspa://operations resource.'
        });
      }
      const schema = describeOpKind(kind);
      if (schema === undefined) {
        return text({
          ok: false,
          kind,
          knownKinds: knownOpKinds(),
          hint: `No dedicated entry for "${kind}". Every remove_* op shares one generic form; see the unspa://operations resource for those.`
        });
      }
      return text({ ok: true, kind, schema });
    }
  );
};
