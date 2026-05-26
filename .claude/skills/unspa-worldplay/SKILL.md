---
name: unspa-worldplay
description: Use to actually walk a player through a world built with Unspaghettit — chat-explorable text-adventure style. Keeps the runtime state in a save file at `.unspa-world/<featureId>.save.json` so the model never relies on its own eroding context for the player's purse, inventory, time of day, or location. Each turn re-reads the save, maps the user's intent to a modeled Action, asks the MCP's simulator to resolve it, applies the resulting diff back to the file, and narrates. Triggers on "walk in", "enter the world", "let me play", "drop me into", "begin the adventure", "start the world", "let's chat-explore", "run the world", "play <world name>".
---

# Unspaghettit: walking a player through a built world

This skill is the runtime counterpart to `unspa-worldbuild`. The world's
**rules** live in the MCP (the spec). The world's **runtime state**
(where the player is, what's in their purse, what time it is) lives in a
file on disk. The agent narrates between the two.

**Read the savegame file every single turn.** The model's own memory of
state is unreliable across long conversations — it summarizes, drifts,
hallucinates earlier facts. The file is canon. The agent's only memory
between turns should be the current chat context, which is allowed to
get fuzzy because the file rescues it.

## The savegame file

**Path**: `.unspa-world/<featureId>.save.json`. Multiple saves per
feature are fine (`...<featureId>.alt.save.json`); the convention is one
canonical save per feature unless the user wants slots.

By default, saves are personal — most users want them excluded from
git. Add `.unspa-world/` to `.gitignore` for repo-wide exclusion, or
to `.git/info/exclude` for per-machine local exclusion. Committing a
save is a deliberate choice (it shares your playthrough state with
anyone who clones the repo).

**Schema** (v1):

```json
{
  "$schema": "unspa-world-save-v1",
  "projectId": "0880ae59",
  "projectName": "Mossbrook",
  "featureId": "6106579d",
  "featureName": "Village Core",
  "personaId": "d904dc44",
  "personaName": "Fresh Traveler",
  "currentSurface": {
    "id": "99d6bbd8",
    "name": "Village Square"
  },
  "turn": 0,
  "snapshot": {
    "world.timeOfDay": "morning",
    "player.purse": 10,
    "player.inventory.lantern": false,
    "...": "..."
  },
  "history": [
    { "turn": 0, "kind": "spawn", "surface": "Village Square" }
  ]
}
```

**Conventions:**
- `snapshot` keys are full dotted state paths (`world.timeOfDay`, not
  just `timeOfDay`). Match how `add_state_definition` declared them.
- `snapshot` includes **every** state def's value, even when it's still
  the default — the MCP simulator reads from this object, and a missing
  key is treated as `undefined`, which usually fails conditions silently.
- `history` is a small ring buffer (cap at ~20 entries) — useful when
  the user asks "what did I just do?" but not big enough to bloat the
  file. Older entries get rolled off.

## Bootstrapping a new save

Triggered the first time the user invokes a play phrase ("play
Mossbrook", "drop me into the village core") and `.unspa-world/<featureId>.save.json`
doesn't exist yet. If the user names a world without specifying a
persona, list the available ones and ask — don't silently pick. If
they say "just start me" or there's only one persona, use that.

Given a chosen feature + persona:

1. `get_feature { featureId, verbose: true }` — get the full blob,
   including every surface, every state definition with its
   `defaultValue`, and the personas.
2. Build the initial `snapshot`: for every state definition across
   every surface, take its `defaultValue`. Use the dotted `path` as the
   key.
3. Apply the chosen Persona's `stateOverrides` on top — last write
   wins.
4. Choose a hub surface as the spawn (usually the feature's first
   surface, or the one declared in the persona's narrative context).
5. Write the file. Echo the surface's `description` to the player as
   the opening narration.

## The per-turn loop

```
on_each_user_message:
  save = read_json(".unspa-world/<featureId>.save.json")
  surfaceId = save.currentSurface.id

  # 1. Discover what's possible here
  actions = list_actions({ featureId, surfaceId })

  # 2. Map intent → action(s)
  candidates = match_user_intent_to_actions(user_message, actions)
  if no candidates:
    narrate_in_world_unavailable(user_message)
    OPTIONALLY offer to extend the world (suggest add_action)
    return
  if multiple candidates:
    ask the user briefly which they mean
    return

  actionId = candidates[0].id
  params = extract_parameters(user_message, action.parameters)

  # 3. Resolve via the simulator (pure, no persist)
  result = dry_run_simulate({
    featureId,
    surfaceId,
    actionId,
    parameters: params,
    snapshot: save.snapshot,
  })

  # 4. Narrate + persist
  if result.status == "blocked":
    narrate_block(result.blockedReason)   # use the rule's `reason`
    # do NOT mutate the snapshot
  else:
    apply_diff(save.snapshot, result.stateDiff)
    if result.transitionTarget:
      save.currentSurface = { id: result.transitionTarget.id,
                              name: result.transitionTarget.name }
    save.turn += 1
    save.history.push({
      turn: save.turn,
      action: action.name,
      status: result.status,
      surface: save.currentSurface.name,
    })
    trim_history(save.history, 20)
    write_json(savePath, save)
    narrate_result(action, result, save)
```

The agent's job is to be a good translator between:
- **User natural language** ↔ **action id + parameters**
- **Result blob** ↔ **prose narration**

Everything in the middle — rule walking, precondition checks, state
diffs, transitions — is done by the simulator, deterministically.

## Mapping user intent to actions

Best practice:

1. Get the surface's actions once at the start of the turn
   (`list_actions { surfaceId }`). Each one has a `name`, an `intent`,
   and optional parameters.
2. Match the user's verb + object phrase to action names and intents.
   "buy a lantern" → "Buy Lantern". "talk to the kid" → "Talk To Cael".
   Synonyms are fine — be permissive.
3. If you match exactly one, use it. If multiple, pick the one whose
   `intent` text best matches, OR ask the user briefly ("Order a drink
   or just talk to him?").
4. If zero match, **don't invent**. Two acceptable responses:
   - In-world refusal: "You don't see how, from here." Then list
     what's possible: "You can examine the well, talk to Cael (if he's
     here), or head back to the square."
   - Offer to extend the world: "I can add a 'Climb The Tree' action
     to this surface if you want — say the word."

## Calling the simulator

```
dry_run_simulate({
  featureId: save.featureId,
  surfaceId: save.currentSurface.id,
  actionId: matchedAction.id,
  parameters: { drinkType: "cider" },     // optional, when action has params
  snapshot: save.snapshot,                 // pass the full state map
})
```

The simulator is **pure** — no persistence on the server side. The
returned blob tells you everything: `status` (success | blocked), the
block reason if blocked, the resulting state diff, the emitted events,
and any transition target. Apply the diff to your in-memory copy of
`save.snapshot`, then write the file. The file is the persistence
layer; the MCP is the rule engine.

## Narrating

**Opening (on spawn):** echo the surface's `description`. Optionally
mention 2-3 visible affordances ("you can see the tavern to the east,
the smithy to the north, and a path south to the old well").

**On success:** narrate the action's intent + the most salient state
changes. "You drop two coppers on the bar; Bram pours you a tankard of
cider, his face cracking into a smile." Don't read out the raw state
diff. Pick the 1-2 things the player would actually notice.

**On block:** use the rule's `effect.reason` verbatim or paraphrased
in-character. That field was written to be the in-world failure
message — trust it. "Bram waves you off; he isn't in the mood to gossip
yet."

**On transition:** narrate the move and immediately describe the new
surface. The player should know where they are.

**On milestone events (`well.descended`, etc.):** lean into the moment.
The event was modeled because it's significant.

## Long sessions and context erosion

After many turns, the conversation context will summarize. That's fine,
because:

- The savegame file is canonical. Re-read it on every turn.
- The MCP's spec is canonical. Re-fetch with `list_actions` and
  `get_action` instead of remembering rules.
- Your own memory is **untrusted**. If you find yourself certain about
  a value ("the player has 7 copper") without re-reading the file
  this turn, you're wrong about something.

If the user asks "what's in my purse?" the answer comes from the
**file**, not memory. Same for time of day, inventory, current location.

## Special meta-commands

These bypass the action-matching layer (the user is talking *about*
the game, not playing it):

| Command | Behavior |
|---|---|
| `!state` | Pretty-print the current `snapshot` and `currentSurface`. |
| `!save` | Re-write the save file (a no-op if you've already persisted; useful as a sanity check). |
| `!load <path>` | Switch to a different save file. |
| `!look` | Re-narrate the current surface without consuming a turn. |
| `!rewind` | Discouraged; if asked, warn that turn-by-turn rewind isn't built in. Restoring from a manual backup is the workflow. |
| `!quit` | End the session; leave the save file as-is. |

These should not produce a `dry_run_simulate` call.

## Handling user requests that don't fit the model

The model is the rulebook. If the player tries something the spec
doesn't cover (climb a tree, set the tavern on fire), the agent has
three honest options:

1. **In-world refuse** — narrate that the option isn't available, list
   what IS available. Cheapest.
2. **Extend the spec** — offer to add an action via `add_action` +
   rules + effects. Only do this if it's clearly a missing piece, not
   a one-off whim.
3. **Out-of-character side note** — drop out of narration briefly:
   "(That's not modeled in this world — want me to add it, or stick to
   what's here?)" Use sparingly.

**Never invent rules.** Don't say "you climb the tree and see…" if
"Climb Tree" isn't a modeled action. The whole point of the spec is
that it stops you from drifting.

## Multi-action sequences

The user might say "buy a lantern and a pick, then head to the well."
That's three actions. Resolve them serially, one at a time:

1. Buy Lantern → simulate → narrate → write save.
2. Buy Pick → simulate (with updated snapshot) → narrate → write save.
3. Approach Well → simulate (handles transition) → narrate → write
   save.

If any step blocks, stop the chain at the failure and let the user
react ("you can't afford both — which one?"). Don't silently skip and
proceed.

## Pace and tone

- 1-3 short paragraphs per turn. Long sessions should still feel
  quick.
- Lean into the surface descriptions and the rule reasons — they were
  written as prose, use them.
- Don't repeat the entire scene every turn. The player remembers.
- When in doubt about prose vs. mechanics, prose wins; the file holds
  the mechanics.

## Don't

- Don't keep state in memory between turns. The file is canon.
- Don't trust your own recollection of state. Re-read.
- Don't invent rules under improv pressure. The spec governs.
- Don't apply mutations on `blocked` results. Block means *nothing
  happens*.
- Don't bloat `history`. Trim to ~20 entries.
- Don't narrate raw JSON. The player sees fiction; the file sees facts.
- Don't fetch `get_feature { verbose: true }` every turn. Re-derive
  the current surface's action list with `list_actions { featureId,
  surfaceId }` per turn — that call is cheap and gives you a fresh
  spec. The "cache" is the MCP itself, not your conversation memory.
- Don't `apply_batch` from inside the play loop. Playtime mutates the
  save file, not the spec. The spec is the world's physics; changing
  it mid-play is rewriting the universe.
- Don't auto-save under a different filename. One canonical save per
  player per feature unless the user asks for slots.
