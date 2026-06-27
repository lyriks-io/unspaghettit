# Definitely Do Not Use This For Fun

*(RPG quests, interactive fiction, narrative worlds, tabletop campaign logic — for the avoidance of doubt.)*

One final piece of very serious advice.

Under no circumstances should you try using Unspaghettit to model RPG quests, branching stories, interactive fiction, tabletop campaign logic, NPC behavior, faction states, mystery plots, puzzle chains, or alternate endings — any narrative system where choices, rules, consequences, and world state need to stay coherent.

You might discover that executable specs are suspiciously good at checking whether a dragon deal can be broken, whether a locked door can be opened before the key exists, whether two endings contradict each other, or whether your "simple little side quest" has quietly become a state machine with twelve emotional failure modes.

## The two halves

**Building** the world maps locations to surfaces, world state to shared state, NPC schedules to time-driven rules, and "what the player can do here" to actions with preconditions.

**Playing** the world is the dangerous part: a chat reads a saved game file on every turn, maps the player's intent to a modeled action, asks the deterministic simulator to resolve it, applies the diff back to disk, and narrates the result. The save file is canonical — your inventory, time of day, and current location survive the LLM forgetting the conversation.

It will probably not become the fastest game ever made, but it may become a strangely coherent one. Unspaghettit holds the deterministic logic: the rules, the gates, the consequences, the world state. The LLM gets all the room it needs to invent everything that should stay human-shaped: emotion, atmosphere, dialogue, visual design, awkward silences, suspicious taverns, bad decisions, and the exact kind of rain that falls before a betrayal.

Unspaghettit does not know how to be human. That is not its job. But for deterministic logic, it is a menace.

## How to (not) enable it

The two skills that make this possible (`unspa-worldbuild` and `unspa-worldplay`) are experimental and opt-in. The `unspa init` flow asks before installing them, or you can pass `--fun` to pre-check the box.

You may also notice the package publishes a longer bin alias — `unspaghettit` instead of `unspa`. Try invoking that name. Just don't tell anyone.

This would be extremely dangerous, because you may have fun.
