---
name: unspa-edit
description: Use when editing an Unspaghettit behavior model — adding, changing, or removing features, surfaces, actions, states, rules, invariants, transitions, effects, parameters, scenarios, personas, resources, entities, events, or projects. Always goes through the Unspaghettit MCP server. Triggers on "unspaghettit", "feature", "surface", "action", "rule", "scenario", "behavior model", or any task touching `unspa/*.feature.json`.
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
`events[]`, and optional `devContext`, `expectedActions[]`, `nonGoals[]`.

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
`expectedAssertions[]` turn a scenario into an executable spec.

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
| `run_all_scenarios` | Executes every scenario through the simulator and checks `expectedStatus` + `expectedAssertions[]`. Run after a structural edit to confirm nothing drifted. |
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
`remove_surface_invariant`, `add_transition`, `update_transition`,
`remove_transition`, `add_effect`, `update_effect`, `remove_effect`,
`add_event`, `update_event`, `remove_event`, `add_scenario`,
`update_scenario`, `remove_scenario`, `add_persona`, `update_persona`,
`remove_persona`, `add_resource`, `update_resource`, `remove_resource`,
`add_entity`, `update_entity`, `remove_entity`, `add_entity_field`,
`update_entity_field`, `remove_entity_field`,
`create_project`, `update_project`, `replace_project`, `delete_project`,
`add_feature_to_project`, `remove_feature_from_project`,
`move_feature_in_project`.

Use the granular tools for one-off tweaks. For anything ≥ 2 ops, use
`apply_batch`.

### Diagnose

| Tool | Use it for |
|---|---|
| `get_spec_gaps` | Spec-depth diagnostics. Prioritized critical + recommended gaps. |
| `get_implementation_gaps` | Implementation coverage gaps (spec vs. `.unspa.json` index). |
| `get_implementation_status` | Detailed per-action / per-surface coverage report. |

## Workflow

1. **Orient.** `get_repo_context` once. Default `featureId` to the
   linked id for the rest of the session.

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
