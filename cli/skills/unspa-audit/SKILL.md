---
name: unspa-audit
description: Use when the user asks "what's implemented", "what's missing", or wants to verify code coverage of an Unspaghettit feature. Reconciles the model in `unspa/*.feature.json` with the implementation map in `.unspa.json`, then queries the Unspaghettit MCP for gap reports. Triggers on "audit", "coverage", "missing", "implemented", "what's left", or whenever spec-vs-code drift is in question.
---

# Unspaghettit: auditing coverage via the MCP

The Unspaghettit model declares what *should* exist (entities in
`unspa/<id>.feature.json`). The behavioral index in `.unspa.json` declares
where each entity *does* live in code (`{ file, line, signature, ... }`
per entity key). The Unspaghettit MCP server reconciles the two and answers
"what's implemented, what's missing, where does this entity live".

You own the read/write loop on `.unspa.json`; the MCP owns interpretation
and reporting. The index is the only mapping between code and spec —
source code is not annotated.

## Tools you will use

| Tool | Use it to |
|---|---|
| `get_repo_context` | First call of any session. Returns `linkedProjectId`, the project's `features[]`, and `behavioralIndex` counts (total / implemented / partial / missing). Audit scope is the whole linked project — every feature in `features[]` is in play. |
| `get_behavioral_index` | Read the current `.unspa.json` index, server-side. Cheaper than re-parsing the file. |
| `get_implementation_gaps` | Authoritative "what is missing/partial/implemented" report. Read this before deciding where to point the user. |
| `get_implementation_status` | Detailed sidecar for one feature (or filtered to one action/surface). Shows captured fields, locations, staleness flags. |
| `get_spec_gaps` | Spec-depth diagnostics. Critical + recommended to-do list grounded in entities. Catches shallow specs (effect-less actions, stateless surfaces, untested destructive paths, etc.), orthogonal to "is code indexed?". |
| `get_drift` | Spec→code drift: implementations audited against an OLDER spec than the one now on disk — the `entry.specVersion` vs `feature.updatedAt` comparison, done for you. Returns `stale` (re-audit these), `unversioned` (audited but never stamped), and `orphans` (keys that no longer resolve). The fastest "what silently went stale" read. |
| `verify` | One gated `pass`/`warn`/`fail` verdict per feature — scenarios + maturity + reachability + bounded model check + drift + cross-feature event coherence. The in-chat form of the `unspa check` CLI. Use to confirm the spec itself is sound before declaring an audit clean. |
| `sync_from_index` | After you rewrite `.unspa.json`, the MCP re-reads it, resolves UUIDs, and posts one report per action and per surface. Use this instead of the lower-level `report_implementation_status_batch` unless you need per-entity granularity. |
| `report_implementation_status` | Fine-grained: sync ONE action or surface plus its children. Use when you intentionally do not want to push the whole index. |

## Workflow

1. **Orient.** `get_repo_context` → confirm `linked:true` and read the
   `behavioralIndex` counts. If `linked:false`, stop and tell the user to
   bind this repo to a project first (the model is unknown without it).

2. **Read current state.** `get_implementation_gaps` is the single most
   useful call. It returns three buckets per feature:
   - **implemented**: spec entity, index entry present, code resolves.
   - **partial**: index entry present but with `status:"partial"` (a
     previous audit pass marked it as incomplete) or with known gaps attached.
   - **missing**: spec entity has no index entry at all.

3. **Decide whether you need to re-audit code.** If the user says "refresh
   coverage" or the index `auditedAt` is stale relative to recent commits,
   you walk the code yourself with file-search tools. For each spec entity
   that exists in code, write or update the corresponding entry in
   `.unspa.json` with `file`, `line`, `signature`, and any audit metadata
   (`auditedAt`, `gitCommit`, `kind`, `relatedFiles`, `testFile`,
   `knownGaps`). Then call `sync_from_index`.

4. **Read the reconciled report.** `get_implementation_status` shows per
   action / per surface: found entities + their locations + captured
   fields, missing entities. The MCP marks `stale:true` when the audited
   signature no longer matches the indexed line and proposes a
   `suggestedLine` when it can heal the drift.

5. **Surface spec-depth issues.** `get_spec_gaps` returns a prioritized
   to-do list:
   - **critical**: missing `expectedActions`, stateless surfaces,
     effect-less actions, destructive actions with no scenario.
   - **recommended**: async actions without loading/error scenarios,
     validation actions without a blocking rule, multi-state surfaces
     without transitions, actions never reported in implementation
     status.

   Resolve every critical gap before declaring the audit clean.
   Recommended gaps are a defensible backlog.

6. **Check for drift, then verify.** Call `get_drift` to find code audited
   against an older spec than the one on disk (a rule changed under an
   implementation you previously mapped) — re-audit the `stale` entries. Then
   `verify` for the one-call verdict: it runs the whole spine (scenarios +
   maturity + reachability + model check + drift + cross-feature event
   coherence + verified coverage) and reports `pass` / `warn` / `fail` per
   check. A clean `verify` (plus zero critical spec gaps) is what "the audit is
   clean" means. The same gate runs headlessly in CI as `unspa check`.

7. **Distinguish claimed from proven.** A `.unspa.json` `{file,line}` entry
   says an entity is *implemented*, not *correct*. To prove it, run the
   feature's scenarios against the real code: `unspa scenarios export` →
   `vitest run --reporter=json` → `unspa coverage ingest <report>`, which
   stamps `verifiedAt` on actions whose scenarios all passed. `verify` reports
   the proven share; `unspa check --min-verified <pct>` gates on it. An honest
   audit reports both: indexed coverage **and** verified coverage.

## Reading the index correctly

`.unspa.json` is keyed `"<entityType>:<id-name-or-path>"` where the
id portion depends on the type:

- `action:<id>`, `surface:<id>`, `rule:<id>`, `invariant:<id>`,
  `transition:<id>`, `surface_rule:<id>`, `surface_invariant:<id>`,
  `entity:<id>` → id is the 8-char hex minted by the spec. Get it via
  `get_behavioral_index` or `get_feature(verbose:true)`. Slug-shaped
  keys are not accepted.
- `event:<event-name>` → the event's literal string identifier.
- `state:<dotted.path>` → the state definition's path (e.g.
  `cart.itemCount`).

Every entity must have its OWN entry — an action entry does **not** also
cover its child rules/events/invariants. The MCP's `sync_from_index`
will report a child as missing if there is no dedicated key for it,
even when the parent action is at `status:"implemented"`. There is no
parent fallback by design — a child sharing the parent's snippet would
mislead the dashboard.

`sync_from_index` also returns an `orphans` block listing any keys in
`.unspa.json` that do not match a spec entity (typo, wrong format,
removed entity). `ok` is true only when there are no orphans, so the
caller sees the problem immediately instead of finding zero coverage
on the dashboard with no diagnostic.

## Staleness signals

The MCP emits `stale:true` on a location when the audited `signature`
substring no longer appears at (or within ±2 lines of) the indexed `line`.
Two outcomes:
- **Healable**: the signature was found elsewhere in the same file →
  the MCP attaches `suggestedLine`. Update the index entry to the new line.
- **Unhealable**: the signature is gone. Re-audit that entity by hand and
  rewrite the entry, or mark it `status:"missing"` if the implementation
  was removed.

## Don't

- Don't grep source code for `@unspa:` / `@lyriks:` tags. Source is not
  annotated. The index is the only mapping.
- Don't conflate "missing" with "broken". Missing means **unindexed**;
  the behavior may still work in code, just unattributed.
- Don't call `report_implementation_status_batch` when you have an index
  file. `sync_from_index` is the same call without the boilerplate.
- Don't skip `get_spec_gaps`. "Every entity resolves" is not the same as
  "the spec is deep enough to be worth implementing".
- Don't invent index keys. Read existing ones with `get_behavioral_index`
  or open `.unspa.json` directly.

## While you're here: every feature wants an Evolution

Auditing means you have the feature open — so check it has at least one
Evolution (a proposed improvement). If it has none, propose one with
`propose_evolution` (see the unspa-edit skill). Evolutions are *your*
forward-looking product ideas, distinct from the deterministic `get_spec_gaps`
output: gaps are what's structurally missing; Evolutions are what a stronger
version of the product would add. Don't restate a gap as an Evolution.
