---
name: unspa-worldbuild
description: Use when modeling a fictional or interactive world in Unspaghettit — a text-adventure setting, a roleplay environment, a chat-explorable place, a game world, a narrative location. Maps locations to surfaces, world state to shared state, NPC schedules to time-driven rules, and "what the player can do here" to actions with preconditions. Pair with unspa-worldplay for actually walking the player through the built world. Triggers on "build a world", "create a setting", "text adventure", "interactive fiction", "chat-explorable world", "narrative environment", "fantasy village", "sci-fi station", "model a place".
---

# Unspaghettit: building a world you can walk into

This skill extends `unspa-edit`. Read that one first for the tool surface,
the expression grammar, and the validation gates. This skill is *only* the
delta for narrative-world modeling: the conceptual mapping, the proven
build order, and the gotchas that bit me before I wrote them down.

To **play** a world you've built, switch to `unspa-worldplay`.

## The mapping: software-spec terms → world terms

Unspaghettit was built to model software. For a narrative world, reuse
the primitives with a translated reading:

| Unspaghettit primitive | World reading |
|---|---|
| **Project** | The setting itself (Mossbrook, Star Station Apex). One per setting. |
| **Feature** | One playable slice (a district, an arc, a single dungeon). 1–15 surfaces. If your world is bigger, split into multiple Features under the same Project. |
| **Surface** | One **location**: a room, a building, an outdoor area, a vista. `type: "location"`. |
| **StateDefinition (shared)** | World-level and player-level state (time of day, inventory, purse). Declare on a hub Surface, set `sharedWith` to every other surface. |
| **StateDefinition (local)** | Location-specific state (NPC mood, shop stock, "the door is open"). Prefix the path with the location's name (`tavern.bramMood`, `well.grateOpen`). |
| **Action** | A thing the player can do here ("Order Drink", "Open Grate With Key"). Verb-phrase name. |
| **Action rule (block_action)** | A precondition / world law for THIS action ("can't descend without light"). Phrase the condition as the *violation*. |
| **Action effect (set_state)** | A consequence of the action ("buying lantern subtracts 5 copper, grants lantern, sets fuel=8"). |
| **Action effect (transition_surface)** | Movement. The action moves the player to another Surface. |
| **Action emittedEvents** | Signals other parts of the spec can react to (`time.advanced`, `item.acquired`). Use lowercase.dot.separated. |
| **Action `triggeredByEvent`** | Cascading reactions: this action auto-fires when another emits the named event. Bounded by depth 8 / cycle guard. |
| **Feature invariant** | A world law that must always hold (`purse >= 0`, `lit-implies-owned`, `stock >= 0`). Catches contradictions when scenarios run. |
| **Surface invariant** | Same, but scoped to one location. |
| **Persona** | A save-state baseline: starting condition for a scenario. Examples: "Fresh Traveler" (defaults), "Well-Prepared Traveler" (lit lantern, key, etc.). Apply with `personaId` in scenarios. |
| **Scenario** | A playable test of one branch: "what happens if I try to descend without light?" Set `stateOverrides` + `expectedStatus: "success"|"blocked"`. Run via `run_all_scenarios`. |
| **Event** | A world signal (time changed, item acquired, milestone reached). Used for cascading actions. |
| **Resource** | External-system fit; usually not needed for fiction. Skip for v1. |
| **Entity** | Database-shaped record fit; usually overkill for items. Model items as boolean state flags (`player.inventory.lantern`) instead. |
| **Parameter** | Per-action input the player chooses ("which drink?"). Use sparingly — most narrative actions take no parameters. |

## Sizing rule of thumb

- **One Feature** = one district / one floor / one quest area. Hard cap
  at 15 surfaces. If the user describes "a whole continent", push back
  and slice it.
- Per surface: **4–8 actions** is the sweet spot. A surface with one
  action is decorative; a surface with 15 actions is two surfaces
  pretending to be one.
- Total actions per Feature: aim 20–60. Over 80 is a smell.

## The state architecture

Pick one Surface to be the **hub** (usually the entry / central area
— the Village Square, the spaceport lobby). On that hub, declare every
**world** + **player** state path, with `sharedWith` pointing at every
other surface in the Feature:

```
add_state_definition {
  surfaceRef: "s_hub",
  path: "world.timeOfDay",
  type: "enum",
  enumValues: ["morning","noon","dusk","night"],
  defaultValue: "morning",
  sharedWith: ["s_tavern", "s_smithy", "s_well", ...],
  description: "..."
}
```

Then on each surface declare its **local** state with a prefix matching
the surface (`tavern.*`, `smithy.*`, `well.*`). No `sharedWith` —
local state is local.

Why this split: any state that more than one location can read or write
must be shared. Anything specific to one location should NOT be shared
or it leaks. The compiler-grade enforcement is `find_state_references` —
run it before renaming or removing a path.

## The proven build order

Build in **three atomic batches**, in this order. Each batch is one
`apply_batch` call. Refs only survive within one batch — use the
returned IDs from the previous batch for the next one.

### Batch 1 — Skeleton

- `add_surface` × N (the locations). `type: "location"` for all of them.
- `add_state_definition` × M (shared on the hub with `sharedWith`, then
  local on each surface).
- `add_event` × K. **Names must be `lowercase.dot.separated`.** Common
  ones: `time.advanced`, `item.acquired`, `milestone.reached`.
- `add_persona` × P. At minimum: a "Fresh" persona (defaults), and one
  end-game persona with `stateOverrides` for testing the win/exit
  condition without re-running the whole flow.

### Batch 2 — Actions, rules, effects, transitions (one big batch)

This batch is the bulk of the work. Within one batch:

1. First, **all** `add_action` ops with refs (`a_sq_look`,
   `a_tv_drink`, etc.). Use the surface IDs from batch 1's response.
2. `add_parameter` for any action that needs one.
3. `add_action_rule` for every precondition. Pattern: condition is the
   *violation*, effect is `block_action` with a player-facing `reason`.
   Example: drink costs 2 copper, so the rule's condition is
   `purse < 2`, not `purse >= 2`.
4. `add_effect` for every consequence. `set_state` writes; emission of
   events is via `emittedEvents` on the action itself, NOT a separate
   `emit_event` effect (avoids double-fire).
5. `add_effect { type: "transition_surface", target: "<surfaceId>" }`
   for every movement action.
6. `add_transition` for the topology graph (the descriptive edges
   between surfaces). Optional but recommended — gives the UI a clean
   "this room leads to that one" map.

### Batch 3 — Feature invariants + scenarios

- `add_feature_invariant` for the cross-cutting world laws. Phrase the
  condition as the **always-true property** (negate the impossibility):
  - "purse non-negative" → `{ kind:"not", condition:{ left:"player.purse", operator:"lower_than", right:0 } }`
  - "lit implies owned" (¬lit ∨ owned) → `{ kind:"any", conditions:[ {kind:"not", condition:{ left:"player.inventory.lanternLit", operator:"equals", right:true }}, { left:"player.inventory.lantern", operator:"equals", right:true } ] }`
- `add_scenario` × many. Cover at minimum: one success per action, one
  blocked-by-each-precondition per action. Use the end-game persona to
  test the longest path in one shot.

### Then verify

- `run_all_scenarios` — every scenario must pass. **Invariant
  violations in passing scenarios are real flags**: usually a scenario's
  `stateOverrides` set a logically impossible combination (e.g.
  `lanternLit=true` without `lantern=true`). Fix the scenario.
- `score_feature` for a maturity rating.
- `get_spec_gaps` for shallow-modeling flags.

## Naming conventions

- **Surface names**: Title Case noun phrase. "Village Square", "Hearth
  Tavern", "Hilda's Smithy". Avoid prefix repetition across siblings —
  let the Project carry "Mossbrook", let the parent surface carry "the
  market"; don't write "Mossbrook Village Square" or "Market Stall A".
- **Action names**: Title Case verb phrase. "Order Drink", "Open Grate
  With Key", "Force Grate With Pick". Verb first, scope second.
- **Event names**: `lowercase.dot.separated`. `time.advanced`,
  `item.acquired`, `rumor.learned`, `well.descended`. **TitleCase will
  be rejected by the validator.**
- **State paths**: dotted camelCase. Top-level segments are scopes:
  `world.*` (global facts), `player.*` (the user character),
  `<surface>.*` (location-local). Examples: `world.timeOfDay`,
  `player.inventory.lanternFuel`, `tavern.bramMood`.
- **Persona names**: Title Case noun phrase that reads like a save
  slot. "Fresh Traveler", "Well-Prepared Traveler", "Broke Beggar".
- **Description prose**: every authored element requires a
  description. Write them as if the spec is the only thing a future
  agent has — encode the *intent* and any non-obvious constraint.

## Designing rules

The cleanest pattern for preconditions:

```json
{
  "kind": "add_action_rule",
  "surfaceId": "<hub>", "actionRef": "a_tv_drink",
  "rule": {
    "category": "billing_quota",
    "condition": { "left": "player.purse", "operator": "lower_than", "right": 2 },
    "effect": {
      "type": "block_action",
      "reason": "A drink costs 2 copper and your purse is lighter.",
      "description": "Block when player can't afford."
    },
    "description": "Drinks cost 2 copper; without funds, Bram won't pour."
  }
}
```

Note:
- `condition` describes the *violation*; the action is blocked when it
  matches.
- `effect.reason` is the *in-world* message you'll narrate to the
  player. Write it like the NPC is speaking.
- Use `category` honestly: `business` for world logic, `billing_quota`
  for currency / inventory caps, `permissions` for trust / faction
  gating, `security` for "you don't have the key" style locks. The
  category drives `get_spec_gaps` heuristics.
- For composite conditions, use `{kind:"all"|"any"|"not"}` instead of
  multiple flat rules sharing one effect.

For state mutation effects, prefer Expression-based writes over hard
literals when the new value depends on the old:

```json
{
  "type": "set_state",
  "path": "player.purse",
  "value": {
    "kind": "sub",
    "left": { "kind": "state", "path": "player.purse" },
    "right": { "kind": "literal", "value": 2 }
  }
}
```

For "advance time of day" wrapping morning→noon→dusk→night→morning,
use a `switch`:

```json
{ "kind": "switch", "cases": [
    { "when": { "left": "world.timeOfDay", "operator": "equals", "right": "morning" },
      "then": { "kind": "literal", "value": "noon" } },
    ...
  ],
  "default": { "kind": "literal", "value": "morning" }
}
```

## NPC schedules

Don't model NPCs as personas; model them as **state** plus
**schedule-driven rules**. Examples that work:

- **Presence as a derivation**: `caelPresent` is implicit — every
  action that needs Cael adds a rule `world.timeOfDay != "dusk" → block`.
- **Mood as state**: `tavern.bramMood ∈ {gruff, cheerful, generous}`.
  Effects move him: buying a drink sets `generous`; rude actions could
  set `gruff` (and gate dialogue).
- **Stock as state**: `smithy.stockLanterns: number`. Decrement on
  purchase; the out-of-stock rule blocks when it hits 0.
- **Mutual exclusion via time**: Hilda is at the smithy morning–dusk,
  at the tavern at night. Both locations have time-based gates on her
  presence; one is always blocked, the other always allows.

If a single NPC needs persistent multi-state memory (Bram remembers a
quest you completed, Cael remembers you betrayed him), give them their
own scoped state path: `player.relationships.bram.trust`,
`player.relationships.cael.knowsAboutBetrayal`.

## Items

Default to boolean flags + parallel number flags for quantities:

```
player.inventory.lantern        : boolean
player.inventory.lanternFuel    : number   (parallel quantity)
player.inventory.lanternLit     : boolean  (parallel state-of)
player.inventory.pick           : boolean
player.inventory.oldKey         : boolean
```

For stackable resources (`player.inventory.coins`, `player.inventory.arrows`):
single `number` path, write via Expression `sub`/`add`.

Only escalate to `add_entity` if items have non-trivial schema (multiple
fields per item, multiple instances of the same item type with distinct
state). For most narrative worlds, booleans + numbers cover it.

## Scenarios that earn their keep

Bad scenarios are restatements of the rules. Good scenarios cover the
*boundaries* and the *paths*:

- One success per action (the trivial happy path).
- One blocked per precondition (each rule gets at least one
  scenario that proves it actually blocks).
- One scenario per persona, testing that persona's end-state can do its
  end-game action (e.g. Well-Prepared Traveler can Descend).
- For any action with multiple AND'd preconditions, one scenario per
  precondition where *only that one* is violated. This catches rule
  spelling errors (e.g. a typo'd state path that always evaluates undefined).

Watch for **invariant violations on passing scenarios** in the
`run_all_scenarios` output. The scenario passes status-wise but
`invariantViolations[]` is non-empty: the `stateOverrides` set an
impossible combination. Fix the override, not the invariant.

## Hand-off to playtime

Once `run_all_scenarios` is green and `score_feature` is at the bar
you want, the world is "playable". Hand off to the `unspa-worldplay`
skill, which assumes:

- A Feature in the MCP whose scenarios all pass.
- A starting Persona id (the "Fresh" one).
- A starting Surface id (the hub).
- An initial snapshot derived from the union of every state
  definition's `defaultValue`, overridden by the chosen persona's
  `stateOverrides`.

That snapshot is what `unspa-worldplay` writes to a savegame file
(`.unspa-world/<featureId>.save.json`) and re-reads each turn.

## Don't

- Don't TitleCase event names. They'll be rejected.
- Don't put player/world state on every surface — declare once on the
  hub, `sharedWith` everywhere.
- Don't write rules as positive preconditions (`purse >= 2 → allow`).
  Write the violation (`purse < 2 → block`).
- Don't add `emit_event` as a separate effect when the action already
  has `emittedEvents`. Double-fire.
- Don't invent a Resource or an Entity for every item. Booleans +
  numbers cover 90% of fiction.
- Don't skip scenarios. A world without scenarios drifts the first time
  someone walks in.
- Don't pad descriptions. Each one should encode intent or constraint a
  future reader couldn't derive from the name alone.
- Don't try to fit a whole continent into one Feature. The 1–15 surface
  cap is a real ceiling — slice the world into multiple Features under
  one Project once you bump up against it.
