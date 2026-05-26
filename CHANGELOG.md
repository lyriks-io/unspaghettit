# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [SemVer](https://semver.org).

## [0.1.6] — 2026-05-27

Adds an experimental Vitest spec generator that closes the spec-vs-code loop — every authored scenario becomes a real unit test driven through a user-written adapter. Plus a small UX pass on tag filtering and the Projects index, and a README restructure for non-tech readability. All changes additive — no schema migration, safe to upgrade in place.

### Added

- **`unspa scenarios export <featureId>` (experimental).** Generates a Vitest spec from a feature's authored scenarios. The deterministic simulator runs each scenario at codegen time and embeds its predicted outcome (status + expected assertions) as the test oracle. The user writes a thin adapter — `UnspaAdapter` from `unspaghettit/cli/scenarios` — that calls their real implementation; the generated test drives every scenario through that adapter and asserts state path-by-path. Drift between authored `expectedStatus` and simulator prediction is reported per scenario but not gated (the generator emits tests as authored; the human picks which oracle wins). Default output is `./<feature-slug>.scenarios.spec.ts`; flags: `--out`, `--adapter`, `--adapter-export`, `--dry-run`, `--force`. Refuses to clobber an existing file without `--force`. Adapter contract (`UnspaAdapter`, `AdapterInvocation`, `AdapterResult`) is preview and may change between minor versions until the wedge graduates; every emitted file carries that banner in its header.

### Changed

- **Tag filter shows per-type color inside the dropdown.** Each `<optgroup>` gets a background-color tint at 28% of the type's color (a clear colored band on the type header) and each `<option>` beneath gets a lighter 12% wash. Text stays at default; the color reminder reads as a row-background swimlane that doesn't recolor labels. Replaces the inline `TagPillBar` chip row that used to render above the Projects, Features-in-Project, and global Features list views — the selector now carries the color signal alone.
- **Import .unspa button repositioned** to the top of the Projects index header, paired with the "Home" eyebrow. Mirrors the Export .unspa position on a project page and drops the heavier `h-10` styling for the same compact look used by Export.

### Documentation

- **README restructured for audience clarity.** Non-tech one-line hook ("a way to keep AI-assisted software aligned with what you actually meant"), MCP defined on first use with a link, "Who it's for" anchor, Quickstart vs Installation properly differentiated (no duplicate `npm install -g` block), Scenarios callout clarifies spec self-test (`run_all_scenarios`) vs code-vs-spec test (`unspa scenarios export`), Architecture section gains a runtime data-flow diagram before the folder tree, Status + Why-open-source merged into a single "Where this came from", Philosophy tightened from seven mixed-register lines to four consistent principles. Logo URL switched from the npm/jsDelivr CDN to `raw.githubusercontent` so it survives any future change to the npm `files` list.

### Migration

- None. The new CLI command is purely additive. The TagPillBar removal is internal — users who relied on the colored chip row above tag lists now see the same color information in the filter dropdown.

## [0.1.5] — 2026-05-25

Closes every silent-failure path on the report/sync side that 0.1.4 users hit, plus an interactive guided tutorial, project-level history, broader rule expressivity, and a UI / encoding pass. All changes additive — no schema migration, safe to upgrade in place.

### Added

- **Interactive guided tour from project to simulator.** New "Run interactive tutorial" button on the Tutorial page launches a 20-step spotlight tour that walks Project → Feature → Surface → Action → Parameter → Rule → Simulator, prefilling fields and gating each step on the right element being typed or clicked. Implemented as a hexagonal slice (TourStep / TourDefinition / SubmitGuard domain, SpecEventBus port, SharedSpecEventBusAdapter adapter, TourOverlay / TourPanel / TourSpotlight presentation). Required a handful of tour-supporting behavior on existing editors so prefilled content lands in genuinely-blank inputs: empty defaults on new editor rows, ParametersEditor auto-focus on new-row name input, and boolean param auto-seed to `false` so a default "No" registers as a value the validator can read.

- **Read-only project history tab.** The Y.Doc room serving each project already maintained a shared history log, but nothing on the client subscribed. The project page now renders that stream — same visual language as the feature-level HistoryPanel, intentionally stripped of `jumpTo` / `Clear` so a stray click can't time-travel a project out from under its features. Author chips reuse the AI / sys / user palette and surface `actingFor` for MCP-driven edits.

- **Parameters on the left of a rule condition.** `LeafRuleCondition.left` now accepts either a state path or `{ kind: 'param', name }`, so an action rule can branch on its own parameter without an intermediate state write. Threaded through Expression evaluation, FeatureValidator (param-left is action-rule only; rejected on surface rules + feature invariants because they have no parameter scope), MaturityScorer, the `get_action` MCP tool, and the RuleEditor / InvariantEditor UIs (State / Param toggle on the IF row).

- **Labeled MAT / IMPL chips on feature cards.** Replaces the single unlabeled "%" badge with two small stacked chips: `MAT 75%` (color-tiered emerald / amber / red against the maturity scorer) and `IMPL 50%` (same tier scheme when a `.unspa.json` report exists; muted grey "-" with explanatory tooltip when there's nothing taggable yet). Per-feature implementation status fetched lazily so each card updates in place once its report lands.

- **Cross-feature dedupe in project-level tabs.** When the same logical item lives in several features inside one project (a `users` table read by two flows, a `cart.cleared` event emitted from two features, …), the resources / entities / events / transitions tabs previously rendered one row per (feature, item) pair and the tab counter summed across — giving inflated numbers and visually duplicate rows. A new `crossFeatureGroups` service groups by identity (kind|provider|name for resources, namespace for entities, event name, from|to|label for transitions); each panel renders one row per unique item with a "From features" chip column.

- **Library chooser step on add-surface dialog.** Blank-surface creation used to live behind a `<details>` collapsible at the bottom of the template library — invisible unless you knew to look for it. The dialog now opens on a two-button chooser ("Create new" vs "From template"), each route leading to a focused step with a back arrow.

- **Easter eggs.** Type "spaghetti" or punch in the Konami code anywhere outside an input — a noodle drifts across the dashboard.

### Fixed

- **`sync_from_index` now surfaces orphan keys instead of silently skipping them.** Response carries an `orphans: { total, entries: [{ key, hint }] }` block listing every `.unspa.json` key that does not correspond to a spec entity. Each entry includes a targeted hint — slug-shaped ids on id-keyed types (e.g. `action:add-to-cart`) get "use 8-char hex from `get_behavioral_index`"; malformed keys (no `:` separator) get the parse error; the generic case explains the likely causes. `ok` is `false` when orphans are present, OR when `synced === 0` (100% failure to land anything is overwhelmingly misconfiguration, not a successful no-op) — neither situation can pass as success silently.

- **`report_implementation_status` / `_batch` returns `rejectedEntities` for unmatched ids.** Pre-0.1.5, when a `foundEntities[]` entry's `entityId` didn't match any spec entity (wrong format, removed entity, typo), the entry was silently bucketed into `extraTags`. The caller saw `foundCount: 0` with no diagnostic. Now each ack carries `rejectedEntities: [{ entityType, entityId, reason }]` (single-call) or `rejected[]` + `rejectedCount` (batch ack), each with an actionable per-entry reason. `ok: false` is returned whenever rejections are present. `extraTags` is now reserved for caller-supplied tags only.

- **`report_implementation_status` accepts state PATH or hex ID interchangeably.** Pre-0.1.5 state entities had to be reported by their hex id, but `get_implementation_gaps` and the `.unspa.json` index keyed them by path (e.g. `state:cart.itemCount`) — so the natural value the LLM had wasn't accepted, with no error. Now `entityType: "state"` matches on either form. Event entities continue to match on their literal name string (unchanged).

- **Documented behavioral-index key format matches the implementation.** The `CLAUDE.md` / `AGENTS.md` template (`cli/util/context-files.ts`) and both bundled skills (`unspa-implement`, `unspa-audit`) previously documented `action:<slug>` and `invariant:<slug>` — formats the spec never actually mints. They now correctly show `action:<id>` etc. with the 8-char hex contract spelled out and `get_behavioral_index` flagged as the way to look ids up. Existing 0.1.4 users will see the corrected docs the next time they run `unspa init`.

- **Tag chip close icon.** The remove button rendered a literal `Ã-` — UTF-8 bytes for `×` reinterpreted as CP1252 by a Windows editor pass. Swapped for an inline SVG so the glyph is encoding-proof, with `shrink-0` so the icon stops jumping when chips wrap.

- **Restored `cursor: pointer` on interactive elements.** Tailwind v4 Preflight changed the base cursor on `<button>`, `<select>`, `[role=button]` to `default`, making every clickable control feel like plain text. Restored in `@layer base` with a `:not(:disabled)` guard so existing `disabled:cursor-not-allowed` opt-ins keep winning.

- **Sync breadcrumb separator escape.** `formatChangeLabel` previously joined the breadcrumb path with literal `›` bytes that an editor round-trip had mangled to UTF-8-as-CP1252 (`â€º`). Every change since carried the corrupt bytes straight into the persisted Y.Doc history log. Runtime separator now uses the Unicode escape `'›'` so the source file stays ASCII-safe; SyncToast renders `&rsaquo;` for the same reason. Older entries on disk stay corrupt (history is immutable) but everything written from here is clean.

- **MCP server `version` no longer hardcoded.** `mcp-server/server.ts` advertised `0.1.2` in capability negotiation long after the package shipped 0.1.5. Now reads from `package.json` at module load.

### Improved

- **`get_implementation_gaps` exposes the canonical `entityId` per entry** (8-char hex id for state entities, alongside the existing path-shaped `key`). Removes the need for `get_feature(verbose:true)` just to look up a state id.
- **`get_implementation_gaps` returns a `hints[]` block** pointing at follow-up tools when the response calls for them: `get_neighborhood` for batching co-located implementation work; the path-or-id rule for state-entity reporting. Improves discoverability without forcing the LLM to read the full guide.

### Changed

- **Positioning reframed** as "Executable specifications for AI-assisted software development" across the tagline, meta tags, READMEs, tutorial prose, and contributor docs. Same product, sharper words.
- **MCP tool descriptions normalized to ASCII** — em-dashes and curly quotes → ASCII (`-`, `.`, `n/a`). LLM clients render tool descriptions as plain text, and encoding round-trips on the agent side were producing mojibake.
- **Feature card footer** says "X actions" instead of "X capabilities" to match the renamed model.
- **Repo encoding hygiene.** BOM-stripped CLI / docs / skills; mojibake stand-ins replaced with proper UTF-8 (`×`, `↔`, `§`, `›`); `.gitattributes` enforces LF on commit so Windows editor round-trips can't reintroduce CRLF + BOM drift. Most critical fix: `cli/util/context-files.ts` — the `unspa init` template that lands in every user's `CLAUDE.md` / `AGENTS.md` — carried a corrupt `~10Ã- larger` that was about to ship to every new user.

### Infrastructure

- **`scripts/sync-skills.cjs`.** `cli/skills/` is canonical — it's what `unspa init` ships into each user's repo. The same three skills also live under `.claude/skills/` so they apply when working on this repo. They drifted once already. The new script mirrors src → dest; `--check` mode fails byte-identical asserts on drift. Wired into `npm test` and `prepublishOnly` so a one-sided edit can never reach npm.

### Dependencies

- `@sveltejs/kit` → 2.61.0, `vite` → 8.0.14, `ws` → 8.21.0. CI `actions/checkout` → v6, `actions/setup-node` → v6.

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

- The public contract — MCP tool surface, `.unspa.json` index format, snapshot JSON schema, dashboard REST API, CLI flags, and generated TypeScript types — is at v0.1. Breaking changes to any of these are signalled by a bump to `0.2.0`, so `"unspaghettit": "^0.1.x"` is safe to auto-upgrade.
