---
name: unspa-implement
description: Use when writing application code that implements an item from an Unspaghettit model (action, rule, invariant, transition, state, event, surface_rule, surface_invariant, entity). Records the implementation location in the `.unspa.json` behavioral index and syncs coverage to the MCP. Triggers when implementing a Feature the user described in Unspaghettit terms.
---

# Unspaghettit: implementing the spec in code

Implementing an Unspaghettit entity is a two-step loop:

1. Write the application code.
2. Record the location in `.unspa.json` (the behavioral index) and call
   `sync_from_index` so the MCP refreshes the coverage report.

The MCP cannot see your code. The `.unspa.json` index is the only contract
between spec and code. Do not annotate code with tags — the index is the
single source of truth.

## Tools you will use

| Tool | Use it to |
|---|---|
| `get_repo_context` | First call. Returns `linkedProjectId` and the project's `features[]`. Pick the right featureId for what's being implemented from `features[]` based on file paths + the user prompt; when ambiguous, ask. |
| `get_action` | Authoritative source for the entity's id, slug, and child ids. **Never invent these.** When the feature has `devContext`, the response also includes implementation guidance for each child entity. |
| `get_behavioral_index` | Read the current `.unspa.json` index server-side. Cheaper than re-parsing the file when you only need a few keys. |
| `sync_from_index` | After you write the index, the MCP re-reads `.unspa.json`, resolves UUIDs from the spec, and posts one report per action + one per surface in a single call. **Always end an implementation loop with this.** |
| `report_implementation_status` | Fine-grained alternative: sync ONE action or surface plus its children. Useful when you don't want to push the whole index, or when you want to attach `capturedFields` payloads for the spec-vs-code diff. |
| `get_implementation_status` | Inspect the current sidecar for one feature after syncing. Confirms what the MCP recognized. |
| `get_implementation_gaps` | Quick "what's left to implement". |
| `get_spec_gaps` | Spec-depth check. Pair with the above before declaring the implementation pass complete. |

## The behavioral index entry

Each spec entity that exists in code gets its own entry in `.unspa.json`,
keyed `"<entityType>:<id-or-slug-or-path>"`:

```
action:<slug>
rule:<id>
invariant:<slug-or-id>
transition:<id>
state:<dotted.path>
surface_rule:<id>
surface_invariant:<slug-or-id>
event:<event-name>
entity:<id>
```

**Get the exact key from the MCP.** Do not synthesize slugs or guess ids
from memory.

Minimum fields per entry:

```json
{
  "action:add-to-cart": {
    "status": "implemented",
    "file": "src/features/cart/AddToCart.ts",
    "line": 42,
    "signature": "export const addToCart = (..."
  }
}
```

Recommended audit metadata (the dashboard uses these for staleness +
navigation):

```json
{
  "auditedAt": "2026-05-20T12:00:00.000Z",
  "gitCommit": "abc1234",
  "specVersion": "<feature.updatedAt at audit time>",
  "kind": "svelte-route | svelte-store | svelte-component | mcp-tool | domain-service",
  "relatedFiles": [{ "file": "...", "line": 1, "role": "test" }],
  "testFile": "src/features/cart/AddToCart.test.ts",
  "knownGaps": ["validation for stock=0 not yet implemented"]
}
```

Every entity that exists in code needs its **own** index entry, including
each rule, invariant, transition, event, state, and entity declaration.
There is **no parent fallback**. An action entry does not cover its child
rules; a surface entry does not cover its states. Children without their
own key will be reported as missing even when the parent is `implemented`.

## Workflow

1. **Fetch the entity.** `get_action` for the action you are about to
   implement. Read its rules, invariants, transitions, emittedEvents,
   parameters, requiredStates from the response. These are the entities
   you must index after implementing them.

2. **Write the code.** Implement the behavior. **Do not** add any
   `@unspa:`, `@lyriks:`, or other Unspaghettit annotations in source.
   The index is the only place where code↔spec mapping lives.

   Quality bar — read the MCP guide section `unspa://guide § Implementation quality`
   before writing the first file. The short version:

   - **Produce code indistinguishable in quality and style from what
     already exists.** Sample one piece of logic, one I/O path, one UI
     surface, one test before writing. If the repo has conventions,
     match them, even where you would have chosen differently.
   - **Greenfield → scale structure to the work.** One file for a
     script; flat module for a small feature; folders separating logic /
     I/O / UI for a medium feature; formal ports + adapters only when
     the feature is big enough to justify the ceremony. Don't add
     layering by reflex.
   - **Three principles always hold:** (1) pure logic doesn't import
     I/O; (2) UI doesn't contain business logic; (3) external
     dependencies (time, storage, network, IDs) are substitutable so
     tests can fake them. Everything else is a judgment call.
   - **Bar**: code a senior reviewer would accept without rewriting from
     scratch. The user will refactor further — give them something
     coherent to refine.

3. **Update `.unspa.json`.** Add or update an entry for every entity you
   just implemented. Use your file tools (Read + Edit on `.unspa.json`).
   The MCP does not write the index, by design.

4. **Capture fields when useful.** For rules, states, and entities,
   `report_implementation_status.foundEntities[].capturedFields` accepts
   a JSON blob shaped like the spec entity (e.g.
   `{ condition: { left, operator, right }, effect: { type, ... } }` for
   a rule). The dashboard's diff mode compares this to the spec and lets
   the user "Use code →" to align the spec to the actual implementation.

5. **Sync.** Call `sync_from_index`. The MCP reads the file, resolves
   every UUID against the spec, attaches the audit metadata, and posts
   one full report per action and per surface. The response includes a
   `stale` block listing any indexed lines whose audited signature no
   longer matches; healable entries get a `suggestedLine` you should
   write back to the index.

6. **Verify.** `get_implementation_status` confirms what landed, then
   `get_implementation_gaps` shows what's still missing. Pair with
   `get_spec_gaps` to catch shallow specs that *look* covered but lack
   scenarios, blocking validation rules, etc.

## "Don't ask, just build" mode

If the user's prompt signals one-shot autonomy ("one pass", "make
assumptions", "don't clarify", "as if we never spoke", "just build it"),
you have no second turn to ask follow-ups. Spec depth is on you. Before
writing any application code:

1. Call `set_expected_actions` with the actions the prompt implies.
   This is your written commitment to the user.
2. Call `set_non_goals` with what you are deliberately not building.
3. For every Action you add (use `add_action` with `roles[]`, or patch
   existing ones via `update_action`), set the role honestly: `entry`,
   `primary`, `validation`, `feedback`, `destructive`, `async`,
   `persistence`. Multi-valued — an action can be both `primary` and
   `async`. These drive `get_spec_gaps`.
4. Write scenarios *before* code via `add_scenario`. Every action gets
   at least one. Anything tagged `destructive` gets a covering scenario.
   Anything tagged `async` gets one scenario whose stateOverrides or
   expectedAssertions touch a path containing `loading` and one touching
   `error`.
5. Before claiming the task complete, call `get_spec_gaps` and resolve
   every `critical` entry. Recommended entries are a defensible backlog,
   but skipping any of them should be a deliberate choice, not an
   oversight.

## What you can and cannot do

You **can**:
- Read the spec via `get_action`, `get_feature`, `list_actions`.
- Read and write `.unspa.json` directly with your file tools.
- Call `sync_from_index`, `report_implementation_status`,
  `report_implementation_status_batch` to push coverage to the MCP.
- Call `get_implementation_status` / `get_implementation_gaps` /
  `get_spec_gaps` to inspect the result.

You **cannot**:
- Have the MCP scan code. It never reads source files. You walk the
  code; the MCP reads only `.unspa.json`.
- Have the MCP edit `.unspa.json`. The MCP reads it but does not write
  it. You own the index.

## Don't

- Don't drop `@unspa:` or `@lyriks:` tags into source code. The index
  is the only place that maps code to spec.
- Don't add an entity to code and forget its `.unspa.json` entry in the
  same change.
- Don't write an action entry and skip its child rules / events /
  invariants / transitions. Each child needs its own key.
- Don't end an implementation loop without calling `sync_from_index`.
  The dashboard stays out of date until you do.
- Don't conflate "code works" with "spec is satisfied". `get_spec_gaps`
  is the last gate.
