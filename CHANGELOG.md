# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [SemVer](https://semver.org).

## [0.1.5] — 2026-05-24

Closes every silent-failure path on the report/sync side that 0.1.4 users hit. All changes additive — no schema migration, safe to upgrade in place.

### Fixed

- **`sync_from_index` now surfaces orphan keys instead of silently skipping them.** Response carries an `orphans: { total, entries: [{ key, hint }] }` block listing every `.unspa.json` key that does not correspond to a spec entity. Each entry includes a targeted hint — slug-shaped ids on id-keyed types (e.g. `action:add-to-cart`) get "use 8-char hex from `get_behavioral_index`"; malformed keys (no `:` separator) get the parse error; the generic case explains the likely causes. `ok` is `false` when orphans are present, OR when `synced === 0` (100% failure to land anything is overwhelmingly misconfiguration, not a successful no-op) — neither situation can pass as success silently.

- **`report_implementation_status` / `_batch` returns `rejectedEntities` for unmatched ids.** Pre-0.1.5, when a `foundEntities[]` entry's `entityId` didn't match any spec entity (wrong format, removed entity, typo), the entry was silently bucketed into `extraTags`. The caller saw `foundCount: 0` with no diagnostic. Now each ack carries `rejectedEntities: [{ entityType, entityId, reason }]` (single-call) or `rejected[]` + `rejectedCount` (batch ack), each with an actionable per-entry reason. `ok: false` is returned whenever rejections are present. `extraTags` is now reserved for caller-supplied tags only.

- **`report_implementation_status` accepts state PATH or hex ID interchangeably.** Pre-0.1.5 state entities had to be reported by their hex id, but `get_implementation_gaps` and the `.unspa.json` index keyed them by path (e.g. `state:cart.itemCount`) — so the natural value the LLM had wasn't accepted, with no error. Now `entityType: "state"` matches on either form. Event entities continue to match on their literal name string (unchanged).

- **Documented behavioral-index key format matches the implementation.** The `CLAUDE.md` / `AGENTS.md` template (`cli/util/context-files.ts`) and both bundled skills (`unspa-implement`, `unspa-audit`) previously documented `action:<slug>` and `invariant:<slug>` — formats the spec never actually mints. They now correctly show `action:<id>` etc. with the 8-char hex contract spelled out and `get_behavioral_index` flagged as the way to look ids up. Existing 0.1.4 users will see the corrected docs the next time they run `unspa init`.

### Improved

- **`get_implementation_gaps` exposes the canonical `entityId` per entry** (8-char hex id for state entities, alongside the existing path-shaped `key`). Removes the need for `get_feature(verbose:true)` just to look up a state id.
- **`get_implementation_gaps` returns a `hints[]` block** pointing at follow-up tools when the response calls for them: `get_neighborhood` for batching co-located implementation work; the path-or-id rule for state-entity reporting. Improves discoverability without forcing the LLM to read the full guide.

### Migration

- None. 0.1.4 `.unspa.json` files with correct (hex) keys keep working unchanged. Files written against the old (incorrect) docs with slug-shaped keys now surface in `sync_from_index`'s `orphans` block with hints for fixing them. Code paths that read `extraTags` continue to work (the field is now narrower — caller-supplied only — but never grew unbounded with rejected entries in the first place).

## [0.1.0] — 2026-05-20

Initial public release. Early but functional.

### Highlights

- **Structured behavioral runtime.** Domain → Project → Feature → Surface → Action, with states, rules, invariants, transitions, effects, events, entities, resources, personas, and scenarios. Every shape validated on every write.
- **MCP-native tool surface.** Locked at v0.1: ~100 tools across read, granular write, atomic batch (`apply_batch`), simulation (`dry_run_simulate`, `run_all_scenarios`), diagnostics (`score_feature`, `get_spec_gaps`, `get_implementation_gaps`), and code-side audit (`get_behavioral_index`, `sync_from_index`, `report_implementation_status`).
- **Deterministic simulator with executable scenarios.** Every scenario is an assertion with pass/fail per `expectedAssertions[]`. Cascade event handlers, persona overrides, surface invariants in result.
- **Index-only code↔spec mapping.** `.unspa.json` is the single source of truth for where each entity lives in code. No source-code tag annotations.
- **Typed scaffolding.** `generate_types` emits TypeScript types for state shapes, event names, and action parameter types. Drift surfaces at the TypeScript level the moment the spec changes.
- **Local-first.** Everything in your repo. No telemetry, no hosted servers, no cloud dependency. Snapshots are plain JSON.
- **Multi-agent ready.** Bundled Yjs WebSocket server lets multiple humans and/or LLMs edit the same runtime in real time.
- **SvelteKit dashboard.** Browse the model, run the simulator, inspect maturity + coverage. `unspa dashboard` boots it locally.

### CLI

`unspa init` registers the MCP server with Claude Code, Cursor, Gemini, Windsurf, Kiro, and Codex (manual snippet). Scaffolds `unspa/`, seeds `CLAUDE.md`/`AGENTS.md` with the runtime instructions, installs the bundled `unspa-edit` / `unspa-implement` / `unspa-audit` skills. Idempotent.

`unspa serve` runs the bundled MCP server on stdio.

`unspa dashboard` opens the SvelteKit dashboard at http://localhost:3000.

### Sample project

The Load samples button delivers an end-to-end **eShop** project (4 LLM-sized features: Account & auth, Catalog & reviews, Cart & checkout, Order fulfillment). Every feature scores 100% maturity. Designed to exercise the full capability surface — composite + Expression conditions, feature invariants, event cascade, `bypassInvariants`, action invariants, scenarios, persona overrides, entity/resource mapping.

### Known limitations

- No published npm package yet — runs from a clone via `npm link`.
- The MCP tool surface is at v0.1; breaking changes are signalled by a bump to `0.2.0`.
