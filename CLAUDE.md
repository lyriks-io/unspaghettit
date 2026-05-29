<!-- >>> unspa -->
## Unspaghettit (auto-managed by `unspa` CLI)

This repo models its software as executable behavior with [Unspaghettit](https://unspaghettit.dev).
The model lives in your Unspaghettit snapshots folder — the shared hub
(`~/.unspa-hub/unspa`) by default, or this repo's `unspa/` folder for a
per-repo install (`unspa init --local`). Open the dashboard with
`unspa dashboard` (http://localhost:3000) to see surfaces, actions, simulator,
maturity, and implementation coverage.

### Editing the model. Use the MCP, don't re-emit JSON

The Unspaghettit **MCP server** is registered for this repo. Prefer its tools over
hand-writing or regenerating the JSON. They validate, preserve cross-references,
and produce smaller diffs. Workflow:

1. Discover with `list_features` then `list_actions`. `get_feature`
   returns an INDEX (ids + names + counts) by default; pass `verbose:true` only
   when you genuinely need the full blob (it's ~10× larger).
2. Drill into one entity at a time with `get_action`.
3. For multi-step edits use `apply_batch`. N ops in one atomic load + validate +
   save. Add ops can capture their new id under `op.ref` so later ops in the same
   batch reference it via `*Ref` (e.g. `surfaceRef:"shop"`).
4. Validate risky proposals with `dry_run_simulate` (pure, no persist) and
   `score_feature` before committing.
5. Run `find_state_references` before renaming or removing a state path.

### `.unspa.json`. Record implementations in the index

When you implement an entity in code, add or update its entry in the
`.unspa.json` behavioral index — **do not** annotate source code. The index
is the only mapping between code and spec. Keys follow
`<entityType>:<id-or-slug-or-path>`:

- `action:<slug>`
- `rule:<id>`
- `invariant:<slug>`
- `transition:<id>`
- `state:<state.path>`
- `surface_rule:<id>` / `surface_invariant:<slug>`
- `event:<event-name>`
- `entity:<id>`

Each entry stores `{ file, line, signature, ... }`. After editing the index,
call `sync_from_index` so the MCP refreshes the coverage report.

### Don't

- Don't regenerate an entire feature JSON from scratch; mutate via the MCP.
- Don't add `@unspa:` / `@lyriks:` annotations to source code; the index is the only mapping.
- Don't rename a state path without `find_state_references` first.
<!-- <<< unspa -->
