---
name: unspa-edit
description: Use when editing an Unspaghettit behavior model - adding, changing, or removing features, surfaces, actions, states, rules, invariants, transitions, effects, parameters, scenarios, personas, resources, entities, events, or projects. Always goes through the Unspaghettit MCP server. Triggers on "unspaghettit", "feature", "surface", "action", "rule", "scenario", "behavior model", or any task touching `unspa/*.feature.json`.
---

# Unspaghettit: editing the model via the MCP

The behavior model is the source of truth for the feature. The MCP
server is the only sanctioned way to mutate it. Every write is loaded,
transformed, validated (schema + reference integrity), and saved as one
atomic operation. The `unspa/*.feature.json` file is a debounced
snapshot of that state, never edit it by hand.

## The hierarchy in 30 seconds

`Domain → Project → Feature → Surface → Action → State / Rule / Effect`

A **Feature** is ONE coherent slice of behavior inside a Project, one
flow, one screen, one capability the product offers, sized so you can
hold the whole thing in head at once. Rule of thumb: ~1–15 surfaces,
~30–100 actions. A Feature is NOT a whole product. "Add filter to search
results" is one Feature; "Spotify clone" is a Project that holds many
Features. If the user describes a whole product, push back and pick a
slice first.

A **Project** is the umbrella for one product or codebase. It groups
many Features. Use `add_feature_to_project` to attach.

## The domain in 60 seconds

A **Feature** holds `surfaces[]`, `personas[]`, `resources[]`, `entities[]`,
`events[]`, `featureInvariants[]` (cross-surface safety), `reachabilityGoals[]`
(liveness: `reachable` / `always_reachable` target states), and optional
`devContext`, `expectedActions[]`, `nonGoals[]`.

A **Surface** is one context (screen, terminal, workflow, canvas, ...) with
`stateDefinitions[]`, `actions[]`, `rules[]`, `invariants[]`,
`transitions[]`.

An **Action** is a user/AI-triggerable action with `parameters[]`,
`requiredStates[]`, `rules[]`, `invariants[]`, `effects[]`,
`emittedEvents[]`, `transitions[]`, optional `scenarios[]`, and optional
`roles[]` (`entry | primary | validation | feedback | destructive | async
| persistence`).

**State** lives at dotted paths (`cart.itemCount`). A **StateDefinition**
declares the schema (`path`, `type`, `defaultValue`, optional `sharedWith[]`
for cross-surface paths).

**Rules** guard behavior:
`{ category, condition: { left, operator, right? }, effect }`. Operators:
`equals | not_equals | greater_than | lower_than | contains | is_true |
is_false | exists | does_not_exist`. `condition.right` accepts a literal
OR a structured Expression node (see "Expressions" below).

**Effects** are discriminated by `type`:
`set_state{path,value} | show_message{message,tone?} |
emit_event{event} | block_action{reason} | allow_action |
transition_surface{target}`. `set_state.value` also accepts an Expression.

**Scenarios** sit under an action: named state + parameter overrides
that exercise one rule branch. Optional `expectedStatus` and
`expectedAssertions[]` turn a scenario into an executable spec. A scenario can
set `personaId` so `run_all_scenarios` applies that persona baseline before the
scenario's action-specific overrides.

## Expressions

Discriminated by `kind`:

```
{ kind:"literal", value }
{ kind:"state", path }
{ kind:"param", name }
{ kind:"add"|"sub"|"mul"|"div"|"mod"|"min"|"max", left, right }
{ kind:"neg", operand }
```

State-vs-state win condition:
`{ left:"player.laps", operator:"greater_than", right:{kind:"state", path:"match.lapsToWin"} }`.

Atomic state-from-state-and-param write:
`set_state.value = { kind:"add", left:{kind:"state", path:"player.vx"}, right:{kind:"param", name:"ax"} }`.

## Tool surface

### Read

| Tool | Use it for |
|---|---|
| `get_repo_context` | First call. Returns `linkedProjectId` plus the project's `features[]`. Pick the right featureId for the edit from `features[]` based on context (file paths, action name); when ambiguous, ask. |
| `list_features` | Cheap directory listing: id, name, counts. |
| `get_feature` | INDEX by default: ids, names, counts, devContext, `expectedActions`, `nonGoals`. Pass `verbose:true` ONLY when you genuinely need the full blob (≈10× larger). |
| `list_actions` | Actions for a feature, optionally filtered by surface. |
| `get_action` | One action + its parameters, rules, linked state defs, enclosing invariants. Preferred over verbose `get_feature` for single-action work. Pass `actionIds:[...]` to fetch many on one surface in one round-trip (deduped shared metadata). |
| `find_state_references` | Every rule/effect/scenario/parameter binding that touches a given state path. Run before renaming or removing a state. |
| `list_projects` / `get_project` / `get_project_aggregate` | Project = ordered list of features for grouping in the UI. |

### Write (atomic)

| Tool | Use it for |
|---|---|
| `apply_batch` | **Preferred for any multi-op edit.** N ops in one atomic load + validate + save. Add ops may capture their new id under `op.ref`; later ops in the same batch reference it via `surfaceRef`, `actionRef`, `targetRef`, etc., instead of UUIDs. `add_state_definition.sharedWith` also accepts those refs. Pass `dryRun:true` to validate + score without saving. |
| `dry_run_simulate` | Pure simulation: pick an action, supply parameters + snapshot, get the resulting status / state diff / effects. No persistence. |
| `run_all_scenarios` | Executes every scenario through the simulator, applying `personaId` first when present, and checks `expectedStatus` + `expectedAssertions[]`. Run after a structural edit to confirm nothing drifted. |
| `score_feature` | Maturity report. Read it before declaring a build "done". |
| `save_feature` | Escape hatch. Replaces the whole Feature JSON. Validated before save. Prefer `apply_batch`. |

### Write (granular)

`create_feature`, `update_feature`, `delete_feature`,
`set_expected_actions`, `set_non_goals`,
`add_surface`, `update_surface`, `remove_surface`, `move_surface`,
`add_action`, `update_action`, `remove_action`, `move_action`,
`add_parameter`, `update_parameter`, `remove_parameter`, `move_parameter`,
`add_state_definition`, `update_state_definition`, `remove_state_definition`,
`move_state_definition`, `add_action_rule`, `update_action_rule`,
`remove_action_rule`, `add_surface_rule`, `update_surface_rule`,
`remove_surface_rule`, `add_action_invariant`,
`update_action_invariant`, `remove_action_invariant`,
`add_surface_invariant`, `update_surface_invariant`,
`remove_surface_invariant`, `add_feature_invariant`,
`update_feature_invariant`, `remove_feature_invariant`,
`add_reachability_goal`, `update_reachability_goal`, `remove_reachability_goal`,
`add_transition`, `update_transition`,
`remove_transition`, `add_effect`, `update_effect`, `remove_effect`,
`add_event`, `update_event`, `remove_event`, `add_scenario`,
`update_scenario`, `remove_scenario`, `add_persona`, `update_persona`,
`remove_persona`, `add_resource`, `update_resource`, `remove_resource`,
`add_entity`, `update_entity`, `remove_entity`, `add_entity_field`,
`update_entity_field`, `remove_entity_field`,
`create_project`, `update_project`, `replace_project`, `delete_project`,
`add_feature_to_project`, `remove_feature_from_project`,
`move_feature_in_project`, `add_project_invariant`,
`update_project_invariant`, `remove_project_invariant`.

**Cross-feature invariants** live on the Project, not a feature:
`project.projectInvariants` are safety properties spanning member features
(referencing state paths in different features, which a feature invariant
can't). Author with `add_project_invariant` / `update_project_invariant` /
`remove_project_invariant`; the model checker enforces them across the
project's state. Use a feature invariant when the property is within one
feature, a project invariant when it spans two or more.

Use the granular tools for one-off tweaks. For anything ≥ 2 ops, use
`apply_batch`.

### Diagnose

| Tool | Use it for |
|---|---|
| `get_spec_gaps` | Spec-depth diagnostics. Prioritized critical + recommended gaps. |
| `get_implementation_gaps` | Implementation coverage gaps (spec vs. `.unspa.json` index). |
| `get_implementation_status` | Detailed per-action / per-surface coverage report. |
| `model_check` | Bounded state-space exploration: invariant counterexamples (shortest action path), dead actions, deadlocks, unreachable surfaces, reachability-goal results. |
| `verify` | One gated `pass`/`warn`/`fail` verdict per feature (scenarios + maturity + reachability + model check + drift + event coherence) — the in-chat form of `unspa check`. |
| `get_drift` | Implementations audited against an older spec than the one now on disk (stale / unversioned / orphan). |

## Workflow

1. **Orient.** `get_repo_context` once. Default `featureId` to the
   linked id for the rest of the session.

   **Ask which language the spec should be written in** before authoring any
   names or descriptions, and only the FIRST time you write to a model in a
   session (or when starting a new project/feature). Do NOT infer it from the
   language the user is chatting in — someone speaking French may still want an
   English spec (it's often shared with English-speaking teammates or tools).
   Ask once, in one short line ("Which language should I write the spec in,
   English or French?"), then write every name/description/intent/rationale in
   that language for the rest of the session. If they already told you, or the
   existing model is clearly in one language, match it and skip the question.

2. **Discover.** `list_features` → `get_feature` (index) →
   `list_actions` → `get_action` for the one you intend to touch.
   Do not pull `verbose:true` reflexively.

3. **Choose your collaboration mode** *with the user* before modeling. Two
   stances, both legitimate:
   - **Scaffolding**: create surfaces + action skeletons, leave rules
     and invariants empty for later. Right when the user wants the shape
     first.
   - **Deep modeling**: fill in rules, invariants, transitions, effects.
     You must ASK the user for each piece of domain logic you cannot
     derive from the existing model. Rules encode what is allowed and
     blocked. Invariants encode what must always be true. Transitions
     encode where the user goes. Only the user knows that.

4. **Edit via `apply_batch`** whenever you have two or more ops.
   Capture refs for later in the same batch. Example flow for a new
   surface with action + rule + effect:

   ```json
   {
     "featureId": "...",
     "operations": [
       { "kind": "add_surface", "ref": "shop", "name": "Shop", "type": "screen" },
       { "kind": "add_state_definition", "surfaceRef": "shop",
         "path": "user.signedIn", "type": "boolean", "defaultValue": false },
       { "kind": "add_action", "ref": "addToCart", "surfaceRef": "shop",
         "name": "Add to cart", "intent": "Append focused product to cart.",
         "roles": ["primary"] },
       { "kind": "add_action_rule", "surfaceRef": "shop",
         "actionRef": "addToCart",
         "rule": {
           "category": "permissions",
           "condition": { "left": "user.signedIn", "operator": "is_false" },
           "effect": { "type": "block_action", "reason": "Sign in to add to cart." }
         }
       }
     ]
   }
   ```

   Pass `dryRun:true` first if the edit is risky; it returns the full
   validation + maturity report without persisting.

5. **Validate.** After non-trivial edits:
   - `run_all_scenarios` confirms scenarios still hold.
   - `score_feature` rates the maturity.
   - `get_spec_gaps` flags shallow modeling (effect-less caps, untested
     destructive caps, async without loading/error coverage, etc.).
   - `find_state_references` before any state rename / removal.

6. **Propose Evolutions.** See the next section. Do this every build pass.

## Evolutions — propose, don't just build

**Non-negotiable: every feature should always carry at least one Evolution (more
when you can).** Whenever you create, edit, OR merely analyze/read a feature —
any time you have it open — check whether it has a fresh, context-relevant
proposal, and add one if it doesn't. A feature with zero Evolutions is an
unfinished thought.

**Evolutions are YOURS, not the tooling's.** They are *your* judgment about what
a strong version of this product would add — drawn from the domain, competitors,
security/UX/accessibility best practices, scale. They are explicitly NOT the
output of `get_spec_gaps`, `score_feature`, or any deterministic check. Those
tools tell you what's structurally missing against the model's own rules;
Evolutions are forward-looking ideas about the *product* that no deterministic
analysis can produce. Never reword a spec-gap into an Evolution — that's the
tooling's job, not a suggestion. (Evolutions are also excluded from those tools'
scoring, so proposing freely costs nothing.)

An Evolution is a forward-looking improvement you raise *proactively*. After you
build or meaningfully edit a feature/surface/action, don't stop at what was
asked: infer what kind of app this is (from the feature name, descriptions,
surfaces, entities, devContext) and surface what a strong version would add.
Examples:

- An email/password auth feature → "Sign in with SSO (most competitors offer
  it)", "Rate-limit failed attempts (credential-stuffing defense)", "Offer
  passkeys / WebAuthn".
- A checkout flow → "Express wallet (Apple/Google Pay)", "Address validation",
  "Abandoned-cart recovery".

This is the ONE place you suggest rather than ask. It does not contradict
"don't invent domain logic": an Evolution is an explicitly-labeled *proposal*
with empty behavior, never silently-added rules.

How to record one: call **`propose_evolution`** (featureId, surfaceId, name,
intent, rationale, optional `category` ∈ security | competitor | ux |
accessibility | scale | compliance | other, optional `source`). It creates a
skeleton Action marked as a proposal:

- It is REAL — has an id, shows in the dashboard as a dashed placeholder, can be
  enqueued — but stays OUT of `score_feature` / `get_spec_gaps` until accepted,
  so proposing never drags the maturity score down or generates "does nothing"
  noise. Leave its body empty; flesh it out only on acceptance.
- In an `apply_batch`, the `add_action` op also accepts `evolution:
  {rationale, category?, source?}` if you prefer to propose inline.

After building, present 1–N proposals to the user as a short labeled list with
each rationale. Then, per the user's choice:

- **Schedule it** → `enqueue` with `kind:"action"` and the proposal's actionId.
  This is how a suggestion lands on the implement-next queue.
- **Accept it** (build it now) → `update_action` with `evolution:null` to clear
  the marker (promotes it to a committed action), then model its rules/effects
  like any action.
- **Dismiss it** → `remove_action`.

Keep them high-signal: 1 to 3 strong, specific proposals per feature beat a long
generic list, but never zero. These suggestions are what the "Build map" /
builder-mode dashboard shows as each feature's next ideas, so a feature with no
Evolution shows up empty there.

### Write for a vibe coder, not an architect

The reader is often a non-technical builder who wants to discover and add ideas,
not a senior engineer. Write every Evolution's `name` and `rationale` so a
beginner instantly gets WHAT it is and WHY it helps:

- Plain language, no jargon. Prefer "Let people sign in with Google" over
  "Add OAuth2 / OIDC federated identity provider".
- Lead with the user benefit. The rationale should answer "why would I want
  this?" in one short, concrete sentence (faster signup, fewer lost carts,
  safer accounts, works on mobile, ...).
- Keep it short. One sentence of rationale. No filler.
- **Never use an em dash (—) or en dash (–).** They render badly and read as
  noise. Use a comma, a period, a colon, or parentheses instead. (The dashboard
  joins the name and rationale with a colon, so don't add your own dash either.)
- Concrete, not vague. "Show a loading spinner while saving" beats "improve
  perceived performance".

## What writes return

Every granular write returns a slim ack:
`{ ok:true, featureId, updatedAt, id? }` (id only on add_* ops).
You do not get the full Feature back; re-read with `get_action`
only when you need the new shape. This keeps each write O(1) in tokens
regardless of model size.

## IDs

All ids are opaque server-minted strings. **Never invent them.** Get them
from `list_*` / `get_*` responses or from `apply_batch` refs. The
`asXxxId(...)` constructors will reject malformed strings on the server.

## Don't

- Don't regenerate an entire feature JSON in the prompt. Always mutate
  via the MCP. Hand-edits to `unspa/*.feature.json` will be
  overwritten by the next debounced snapshot.
- Don't pass `verbose:true` to `get_feature` reflexively. The index is
  almost always enough.
- Don't invent action / state / rule shapes from memory. Fetch the
  current one, patch it.
- Don't invent IDs. Read them, ref them, or let `apply_batch` mint them.
- Don't invent domain logic. A vague description is a prompt to ask the
  user, not a license to guess. Rules, invariants, and transitions all
  encode user-owned decisions.
- Don't skip validation. `run_all_scenarios` + `score_feature` +
  `get_spec_gaps` is the standard exit gate after any non-trivial edit.
