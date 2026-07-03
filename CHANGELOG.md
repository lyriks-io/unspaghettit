# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [SemVer](https://semver.org).

## [Unreleased]

Make setup one step for everyone, whether or not they know a terminal.

### Added

- **Zero-setup bootstrap scripts.** `install.ps1` (Windows) and `install.sh` (macOS/Linux) take a machine from nothing to a working MCP: they check for Node.js and install it (winget / Homebrew) when missing or too old, install the CLI, then register the MCP globally with whatever AI clients they detect. One line, no terminal knowledge required:
  - macOS / Linux: `curl -fsSL https://raw.githubusercontent.com/lyriks-io/unspaghettit/main/install.sh | sh`
  - Windows: `irm https://raw.githubusercontent.com/lyriks-io/unspaghettit/main/install.ps1 | iex`
- **Codex is now auto-configured (CLI + VS Code).** A real Codex adapter writes the `[mcp_servers.unspa]` table into `~/.codex/config.toml` (global) or `.codex/config.toml` (project), replacing the old paste-this-snippet stub. The Codex CLI and the VS Code extension share that file, so one write wires up both. Merges into your existing `[mcp_servers.*]` tables without disturbing them; `unspa uninstall` strips it back out.

### Changed

- **`unspa init` registers the MCP globally by default.** The behavior model already lives in the shared hub (one machine-wide source of truth), so the matching default is a machine-wide MCP registration: the tools attach in *every* repo after one install, including clients with no per-project scope (Claude Desktop, Windsurf). A per-repo `.mcp.json` pointing at hub data was the odd combination. Use `--scope project` (pairs with `--local`) for an entry that travels with the repo in git. Per-repo context blocks (`CLAUDE.md` / `AGENTS.md`) and skills still land in the current repo regardless of MCP scope, because they document the repo, not the machine.

### Fixed

- **Claude Desktop on macOS now works out of the box.** GUI apps on macOS launch with a minimal PATH (no `/usr/local/bin`, Homebrew, or nvm), so the old bare `unspa-mcp` command failed to spawn with `ENOENT`. On macOS / Linux `unspa init` now writes an absolute node + script entry (`command: <node>, args: [<.../mcp-server/bin.cjs>]`) that depends on nothing in PATH. Windows keeps `cmd /c unspa-mcp` (GUI apps inherit the user PATH); Claude Code in a terminal was never affected. A node version change can stale the pinned path; re-run `unspa init` to refresh.
- **Detection catches installed-but-unlaunched clients.** The old check only saw a client after its config directory existed (i.e. after first launch), so installing a client and then running setup wired up nothing. Each CLI client is now also detected by its executable on PATH, and Claude Desktop (no CLI) by its install directory, so a fresh install is recognized immediately.

## [0.5.1] - 2026-07-02

A usability and hardening pass: make the dashboard legible on first run, scope MCP setup to the project it belongs to, and close two local-attack surfaces.

### Added

- **First-run onboarding banner.** A "Getting started" strip under the header offers the 3-minute interactive tour, a one-click sample project, and the full guide. It persists per browser and retires itself once the tour is completed or dismissed; the Help page keeps the same shortcuts as the permanent re-entry point.

### Changed

- **Project-first navigation.** The header now surfaces a single top-level destination, Projects, since a Feature only exists inside a project. The MCP playground moved to a per-project page (`/projects/[id]/mcp`), reached from an MCP button on the project header next to Graph, and is auto-scoped to that project (feature selector only, no project dropdown). The old `/mcp` route redirects to the project list.
- **Plainer first-run copy** on the Projects and Features lists, with empty states that explain the Project/Feature model and offer the tour or the sample project.
- **Human-facing docs** (README-adjacent guides, SECURITY, CONTRIBUTING, AGENTS) no longer use em dashes.

### Fixed

- **MCP page load time.** `get_project_aggregate` now loads a project's features concurrently instead of one HTTP round trip at a time, the live tool examples stream in off the main thread instead of freezing the tab, and each example's JSON is formatted only when expanded. The page paints immediately with skeleton/spinner loading states instead of a blank screen.

### Security

- **DNS-rebinding / CSRF hardening on the default loopback dashboard (always on).** A loopback bind alone doesn't keep a browser out: a page you visit can rebind its own hostname to `127.0.0.1` and issue *same-origin* requests to the dashboard, bypassing CORS to read, delete, or import over your local models. Every `/api/*` request and Yjs WebSocket upgrade now must carry a loopback `Host` header, and state-changing requests a same-origin (or absent) `Origin` - a rebinding page sends its own hostname and fails closed with `403`. Needs no configuration; add hostnames with `UNSPA_ALLOWED_HOSTS`, and it steps aside on a wildcard (`--host 0.0.0.0`) bind where `UNSPA_AUTH_TOKEN` is the intended gate.
- **Path-traversal fix on bundle import.** A hand-crafted `.unspa` bundle whose `statuses[].featureId` / `features[].id` contained `../` could make the implementation-status / provenance sidecar write escape the snapshot tree (arbitrary JSON file write). Every id that becomes a filename is now charset-validated at the path-builder layer, and a malformed bundle is rejected with `400` before anything is persisted.

## [0.5.0] - 2026-06-28

The provenance & projection release. Two ways to *see* the model: where every modeled element came from, and what the model looks like as a diagram.

### Added

- **Source Provenance - store the source a model was extracted from, and trace every element back to it.** When an AI agent analyzes an uploaded file through the MCP, Unspaghettit now stores the original file alongside the model and stamps every extracted element (surface, action, rule, invariant, transition, …) with the exact source span it was derived from. A **Source Capture** workflow on the MCP side (`attach_source_file` → `record_element_span` → `finalize_analysis`, gated so finalize requires every element traced) and a dashboard **Source Viewer** that renders the stored file with each span highlighted and bidirectionally linked to its element - click an element to reveal its span and vice versa, toggle and filter highlights by type.

- **Diagram Projections - project one model into many diagram formats.** Render a single feature or a whole project as a statechart (surfaces + transitions), a sequence diagram (event chains), an ER diagram (entities + fields), a per-action flowchart, or a containment mindmap, alongside the existing free behavior graph. Each format is a pure projector that emits a neutral `DiagramSpec`; a **Projection Viewer** draws it interactively (pick scope + format, drill into elements) and an **Export** panel emits it as copyable **Mermaid** or **Graphviz DOT**, or downloads **SVG/PNG**. Projectors register behind a `Projector` port and exporters behind a `DiagramExporter` port, so the viewer depends on the abstraction, not the concrete formats.

### Fixed

- **Graph view fills the viewport** instead of overflowing into a page scrollbar (the new projection toolbar had pushed the canvas past `100dvh`).
- **Dragging the behavior graph / diagram canvas no longer selects surrounding page text.**
- **Feature cards refresh their implementation-coverage score live** when an MCP coverage report arrives, instead of only after a full page reload.

### Changed

- **Documentation restructured** - the README is now a concise overview, with full guides split into `docs/` (getting started, concepts, prompting, collaboration, security, architecture, worlds & quests).
- The dev server moved off Vite's default `5173` (reserved by WSL2/Hyper-V on Windows) to `8173`.

## [0.4.0] - 2026-06-23

The verification release. Unspaghettit moves from *describing* behavior to *proving* it. Bounded model checking explores a feature's reachable state space for invariant violations; **liveness / reachability goals** prove "good is reachable", not just "bad never happens"; **project-level invariants** span features; **cross-feature event coherence** catches dead wiring; and spec→code **drift** plus **verified coverage** close the loop so a divergence between model and code fails the build. A headless **`unspa check`** gate, an **`unspa ci`** scaffold, the **`verify` / `get_drift`** MCP tools, and a dashboard **Verify** view (with navigable counterexample traces) make it executable from CLI, chat, and browser. Plus **global search** across the whole model (⌘K / Ctrl+K) and a **reachability-goals editor**. Additive and non-breaking.

### Added

- **Verified coverage - prove the code matches the spec, and gate on it.** Closes the spec↔code loop, turning the model from "claimed implemented" into "proven against the spec". The generated scenario spec now tags each test with a machine token (`[unspa:surface:action:scenario]`); run it (`vitest run --reporter=json --outputFile=…`) and **`unspa coverage ingest <report>`** stamps `verifiedAt` on the matching `.unspa.json` entries when every one of an action's scenarios passed (and clears the stamp when a scenario regresses). `verify` and **`unspa check --min-verified <pct>`** then gate on the share of a feature's actions that are proven, so a divergence between spec and code fails the build - not just a stale doc. The verdict gains a `verified` check (claimed vs. proven). The full loop: `scenarios adapter` → fill → `scenarios export` → `vitest --reporter=json` → `coverage ingest` → `check --min-verified`.

- **`unspa ci` - scaffold the CI gate.** Writes `.github/workflows/unspaghettit.yml` running `unspa check` on every push / PR, so a failing scenario, a reachable invariant/liveness violation, or spec→code drift fails the build. `--model-check` bakes in the deep checks; idempotent (refuses to clobber without `--force`). Requires the model to travel with the repo (`unspa init --local`).

- **Author reachability goals in the dashboard.** A new **Reachability goals** tab on the feature page (beside Invariants) with add / edit / remove, a `reachable` vs `always_reachable` selector, and the shared condition builder (`StatePathSelect` + operator + right-value editor, leaf or composite). Closes the last dashboard↔MCP parity gap - every authored entity is now editable in both surfaces (feature invariants already had their editor; goals were the one hole).

- **Reachability goals render in the behavior graph.** A `Liveness goal` node wired by `reads` to the state paths it targets, alongside the existing invariant nodes - so the safety (invariants) and liveness (goals) properties of a feature are both visible in the graph.

- **Project-level (cross-feature) invariants.** A `Project` can declare `projectInvariants` - safety properties that span its member features, referencing state paths owned by *different* features (e.g. "the orders feature's open count equals the billing feature's unpaid count"), which a feature invariant structurally cannot express. The verification spine enforces them during bounded model checking: each is checked at every explored state of every feature, over a snapshot seeded with the other features' defaults, and a reachable violation is reported with the action path that reaches it (riding the same counterexample channel as feature invariants). Authored via granular `add_project_invariant` / `update_project_invariant` / `remove_project_invariant` (or `update_project` for a full-replace), evaluated per project cohort by `verify` / `unspa check --model-check`.

- **`unspa scenarios adapter` - scaffold the spec↔code adapter.** Generates the `UnspaAdapter` stub the export command needs: one `case` per scenario-bearing action, pre-seeded with the implementation location recorded in `.unspa.json` (file:line - signature). Removes the last hand-written step in the code-vs-spec loop - `scenarios adapter` → fill the TODOs → `scenarios export` → `vitest`, so a scenario that disagrees with the real implementation fails CI. Experimental, same as the export wedge.

- **Verify view in the dashboard.** A new **Verify** tab on the feature page (`/features/<id>/verify`, beside Graph) that runs the whole verification spine server-side and renders the per-feature verdict: every check `pass` / `warn` / `fail` with its detail, and invariant / liveness **counterexamples rendered as navigable step-chip traces, each with a deep-link that jumps straight to the violating action in the editor** - the model checker's most useful output finally has a human surface. A model-check toggle and re-run button; scoped to the feature's project so cross-feature checks resolve, with sibling verdicts tucked under a "Project context" disclosure. Backed by a new `/api/snapshots/<id>/verify` endpoint over the same `VerifyFeatures` use case the CLI and MCP use, so the dashboard, `unspa check`, and `verify` all agree.

- **Cross-feature event coherence.** `verify` / `unspa check` now reason across a whole project, not one feature at a time. A new pure `analyzeEventCoherence` flags every event handler (`triggeredByEvent`) whose event is emitted by no action anywhere in the cohort - dead wiring a per-feature check structurally cannot see, because the emitter may live in a sibling feature. Surfaced as an advisory `event wiring` check on the feature verdict and an `eventCoherence` block on the report. (The simulator already *resolves* cross-feature cascades at run time; this is the static dual that catches the ones that can never fire.)

- **Liveness / reachability goals - the model checker now proves "good is reachable", not just "bad never happens".** A new feature-level `reachabilityGoals[]` entity, the complement to `featureInvariants` (safety). Each goal has a `kind`: `reachable` (some reachable state satisfies the condition - catches a target the product can never actually get to, like an order status no action sequence reaches) or `always_reachable` (from EVERY reachable state the target stays reachable - catches a flow that can get permanently stuck short of completion, the classic liveness trap). The bounded model checker evaluates goals over the reachable state space and returns, for an `always_reachable` failure, the shortest action path to the trap state. Surfaced in `model_check`, folded into `verify` / `unspa check` as a `liveness` check (a warning by default - bounded, like dead-action findings - escalating to a hard failure with `--fail-on-unmet-goals` / `failOnUnmetGoals`). Authorable via `add_reachability_goal` / `update_reachability_goal` / `remove_reachability_goal` and the matching `apply_batch` ops; validated like a feature invariant (declared condition paths, no param scope). Pure-domain `analyzeSurfaceReachability` and the goal evaluation live in the simulator's `StateExplorer`; persistence is a free round-trip through the snapshot.

- **`unspa check` - headless verification gate.** A non-interactive command that runs the whole verification spine over a project and **exits non-zero on failure**, so the spec can finally break a build instead of staying advisory in a chat window. Per feature it runs every scenario as an executable spec test, scores maturity, analyses surface (navigation) reachability, optionally model-checks the reachable state space (`--model-check`), and folds in spec→code drift. Each check is `pass` / `warn` / `fail`; the run fails only on genuine failures (a failing scenario, a reachable invariant violation, or - when explicitly gated via `--min-maturity` / `--fail-on-drift` / `--require-scenarios` / `--fail-on-dead-actions` - those). Human output by default, `--json` for CI dashboards; scopes to the repo's linked project, or narrow with `--project` / a positional `featureId`. Built as a new `verification` **bounded context** (pure `detectDrift` + `aggregateVerdict` domain, a `VerifyFeatures` use case over a `BehavioralIndexReader` port, file + static adapters); the CLI command and the two new MCP tools are thin driving adapters over the same use case, so chat and CI verify identically.

- **`verify` + `get_drift` MCP tools.** `verify` is the in-chat form of `unspa check` - one gated `pass`/`warn`/`fail` verdict per feature, with optional bounded model checking. `get_drift` makes spec→code drift detection executable: it compares each `.unspa.json` entry's recorded `specVersion` against the owning feature's current `updatedAt` and returns `stale` (re-audit - the spec changed under the code), `unversioned` (audited but never stamped), and `orphans` (index keys that no longer resolve to any spec entity). Previously this comparison was documented but left for the agent to do by hand.

- **Navigation reachability in the model checker.** A new pure static analysis (`analyzeSurfaceReachability`) over the surface-transition graph (declared transitions + `transition_surface` effects) finds surfaces the user can never navigate to (`unreachableSurfaces`) and surfaces with no way out (`terminalSurfaces`). Surfaced in `model_check` next to the state-space results and folded into `verify` / `unspa check` as an advisory check.

- **Global search in the header.** A search bar in the dashboard header (focus it or press **⌘K / Ctrl+K**) that indexes the *entire* model - projects, domains, features, surfaces, actions, parameters, rules, effects, invariants, state definitions, transitions, personas, resources, entities (and nested fields), events, value sets, and scenarios - and opens a big, grouped results menu. Tag text is folded into its project/feature so a tag query still finds its carrier. Results are ranked (exact › prefix › word-prefix › substring, weighted by kind), grouped by type, and keyboard-navigable (↑/↓/Enter); selecting one **deep-links to the exact element**, expands it (an action's card opens so you see the searched item itself, not a collapsed header), and pulses it for ~3s (reusing the feature editor's `?surface=&panel=&focus=` contract + focus observer, now honoring a one-shot `focus` URL param). Built as a hexagonal feature slice (`global-search`): a pure, unit-tested index builder + scorer, an application use case over the repository ports, and a presentation store behind a driven `SearchHost` port. The index builds lazily on first open, is cached, and rebuilds on model-change sync events. Builder mode keeps its own local filter.

### Changed

- **Wider test coverage and a lint gate in CI.** Added end-to-end MCP-tool tests (the implement-next queue, the read/query wrappers, and entity add→update→remove round-trips) driven through the real MCP client, and an **ESLint (flat config) + Prettier** setup wired into CI and `prepublishOnly`. Lint runs alongside the existing cross-OS type-check + test + build matrix, so unused code, unsafe casts, and Svelte template mistakes now fail the build too. No runtime behavior change.

### Fixed

- **A rule-blocked action no longer false-fails its own post-condition invariant.** Action-level invariants are post-conditions of the action *completing*; when a rule blocks the action, no effects run, so the simulator now skips them (feature + surface invariants - state predicates that must hold in every reachable state - still apply). Before, an action invariant like "Confirm delivery → `order.status == delivered`" was evaluated even when a precondition rule blocked the action from a state where it shouldn't fire, so `model_check` reported a reachable "violation" for a guard working exactly as intended. Mirrors the scenario runner already skipping assertions on a blocked action. Surfaced by running the new model checker against the bundled eShop sample, whose **Order fulfillment** feature now verifies clean.

## [0.3.0] - 2026-06-18

Two additive surfaces - an interactive **behavior graph** and an opt-in **Lyriks** dashboard skin - plus a round of Builder-view scaling and two robustness fixes. Non-breaking: the default look and every existing view are unchanged, and the new theme/graph are opt-in.

### Added

- **Behavior graph view.** Renders a feature - or a whole project's features - as an interactive node/edge map of the executable model: surfaces, actions, state, events, parameters, rules, effects, invariants, scenarios, personas, resources, and entities, wired by `contains` / `reads` / `writes` / `emits` / `transitions` / `asserts` / `uses` / `handles` edges. A pure `BehaviorGraphModel` builds the graph from the domain (unit-tested); presentation is split into a `vis-network` renderer adapter and a thin Svelte view. Reachable from a **Graph** link in the feature header and the project editor at `/features/<id>/graph` and `/projects/<id>/graph`; the project graph live-refreshes on sync events.

- **Lyriks community-edition theme + `unspa theme` CLI.** A purely cosmetic skin that overrides the design-system color tokens (and the header/shell chrome) without adding, removing, or moving any feature - every surface and control is identical between themes. Ships the opt-in `lyriks` violet skin alongside the default. Pick it with `unspa theme set <id>` / `reset` / `list` (persisted in `<snapshots>/theme.json`), `unspa init --theme`, or `unspa dashboard --theme`; the dashboard header also has a live palette switcher (persists to `localStorage`). Server-rendered with a no-flash bootstrap, and unknown ids fall back to the default rather than blanking the UI.

### Changed

- **Builder view scales to a full hub.** Project cards now load **progressively** - the cheap project list first, then each scored card streamed in as it resolves (with skeleton placeholders), and a deep-linked `?project=` open loads only that project until you return to the all-projects view. Features list under their **surface** heading. Sync events do a **scoped** rebuild of just the affected project's card (mirroring the Expert view) instead of blanking the dashboard, and the activity toast's **View** button deep-links into the active Builder card, falling back to the Expert route. Tag chips on cards gain an opt-in collapsible mode to reclaim space.

### Fixed

- **A malformed assertion no longer crashes a scenario run.** Untyped scenario data could deserialize an assertion with no state path; evaluating it threw and took down the whole feature's run. A missing/empty path is now reported as not-held, so one bad assertion fails only its own scenario.

- **MCP live-refresh works with zero config in dev too.** With no `UNSPA_SYNC_URL`, the sync notifier now probes the production dashboard port and both loopback families of the Vite dev port (Node 20+ resolves `localhost` to `::1` first on Windows), sticking to the first that answers - so both `unspa dashboard` and `npm run dev` get live refresh and activity toasts without configuring anything.

## [0.2.0] - 2026-05-31

Adds an opt-in **Builder** view alongside the Expert dashboard, with a per-project build queue and per-item goals. Additive and non-breaking: the default dashboard is unchanged (Expert only, no view switcher) and every new MCP field/tool is optional.

### Added

- **Builder view - an opt-in, simpler dashboard.** A second view over the same model: browse projects → core features → features with Maturity / Built dials, accept Evolution-driven suggestions inline, add/edit/delete tags (renames propagate everywhere via the shared `RenameTag` use case), and fill a per-project build queue. Off by default - enable with `unspa init --with builder` (or the init prompt), `unspa view add builder`, or one-off with `unspa dashboard --view builder`. A view registry renders the **Expert | Builder** switcher only when more than one view is on, and `/builder-mode` redirects to Expert when the view is off. Enabled views persist next to the model in `<snapshots>/views.json`. New CLI command group: `unspa view list|add|remove`.

- **Build-queue goals.** Each queued item can carry its own optional goals - a **Maturity** target, an **Implementation (Built)** target (each a drag-to-set progress bar that starts at the item's current score and is tone-colored by value), and/or a **"report it exists in code"** flag. Surfaced to the assistant over MCP: `enqueue` accepts an optional `target`, the new `set_queue_target` tool sets or clears it, and `list_queue` / `get_next_queued` return a plain-language `goal` line. The `unspa-implement` skill now honors a queued item's goals and always records at least presence in `.unspa.json`.

- **Evolutions - LLM-proposed improvements as dashed placeholders.** After building a feature or action, the assistant can now raise forward-looking suggestions (e.g. "Sign in with SSO - most competitors offer it", "rate-limit failed logins") via the new `propose_evolution` MCP tool. An Evolution is a real Action carrying an `evolution: { rationale, category?, source? }` marker and an empty body: it has an id, renders in the dashboard with a dashed violet border + its rationale, and can be added to the implementation queue like any action - but it is **excluded from maturity scoring and `get_spec_gaps`** until accepted, so proposing never lowers the score or generates "does nothing" noise. Accept one with `update_action evolution:null` (clears the marker, promotes it to committed behavior) or dismiss it with `remove_action`. `add_action` (granular + `apply_batch`) also accepts an `evolution` field. The `unspa-edit` skill now instructs the assistant to surface 1–3 high-signal evolutions each build pass.

### Fixed

- **Setting a description (or any field) no longer requires the whole feature to already be valid.** Every MCP write re-validated the entire feature structurally and blocked on *any* error - so a single missing description elsewhere made it impossible to set a description on a feature/action ("impossible without validating the whole feature"). Structural validation is now **diff-aware**, matching the reference-integrity check that already worked this way: a write is blocked only when it *introduces* a new error, never by a pre-existing one. Pre-existing issues stay editable and remain visible via `get_spec_gaps` / `score_feature`. Applied uniformly across all write paths - granular tools (`MutateFeature`), `apply_batch`, and `save_feature` (both the MCP tool and the dashboard's full-replace use case). A brand-new feature with no prior snapshot must still be fully valid; newly-introduced mistakes (bad enum default, duplicate id, new dangling reference) are still rejected.

### Changed

- **The shared hub is now the zero-config default for `unspa init`.** Snapshot discovery (used by both the MCP server and `unspa dashboard`) now falls back to `~/.unspa-hub/unspa` instead of an empty `<cwd>/unspa`, so a bare `init` writes a clean MCP entry with no `UNSPA_SNAPSHOTS` and the dashboard/MCP agree on the first run - no more configuring an env var to make them line up. Cross-platform via `os.homedir()`. Discovery order is otherwise unchanged: explicit override → per-repo `unspa/` found by walk-up → hub. Claude Desktop now resolves the hub automatically (it previously needed `--hub`). Per-repo storage is **not removed** - it's demoted to opt-in: `unspa init --local` (model travels with the repo in git), `unspa init --hub <path>` (custom hub, pins `UNSPA_SNAPSHOTS`), or `unspa init --custom` (interactive picker). New `unspa dashboard --snapshots <dir>` points the UI at any folder for a one-off. Re-run `init` anytime to repoint.

## [0.1.8] - 2026-05-29

Two additive modeling features plus one repository fix. Safe to upgrade in place.

### Added

- **Multi-step scenarios (`Scenario.steps[]`).** A scenario can now carry an ordered list of preceding action invocations, replayed through the simulator before the action under test. Turns a single-action preset into an arrange→act→assert flow, so `run_all_scenarios` verifies cross-action paths (add to cart → apply coupon → checkout). Each step takes its own `parameterOverrides` plus optional `expectedStatus` and `expectedAssertions`; a step that blocks unexpectedly fails the scenario. Backward compatible - scenarios without `steps` behave as before. Authorable via `add_scenario` / `update_scenario` and `apply_batch`.

- **Named value sets (`feature.valueSets[]`).** A reusable enum declared once at the feature level. A StateDefinition or Parameter of type `enum` references it via `valueSetId` instead of inlining `enumValues`, so allowed values live in one place - no more "edit the enum in two places" drift between a state path and the parameters that feed it. Inline `enumValues` still work; no migration. New tools `add_value_set` / `update_value_set` / `remove_value_set` plus matching `apply_batch` ops; values resolve at read time in the validator, the TypeScript codegen, and the simulator.

### Fixed

- **`list()` no longer breaks on shells with a missing `updatedAt`.** All six repositories (Feature/Project/Domain × JsonFolder/InMemory) sorted with an unguarded `b.updatedAt.localeCompare(a.updatedAt)`. `null` threw a `TypeError`; `undefined` silently floated the shell to the top. The bug surfaces via any MCP tool that resolves a short id (`score_feature`, `get_feature`, `apply_batch`, …) because they all call `repo.list()` first. Both sides of the comparator now coalesce to `''`, so shells with no timestamp sink to the bottom.

## [0.1.7] - 2026-05-27

Cosmetic re-release of 0.1.6. The npm tarball is functionally identical - **0.1.6 users do not need to upgrade.** The bump exists so the `v0.1.7` git tag points at a green CI run.

### Fixed

- **Repo tracks the `.claude/skills/` copies of the two opt-in narrative skills.** A stale `.git/info/exclude` on the maintainer's machine was hiding `.claude/skills/unspa-worldbuild/SKILL.md` and `.claude/skills/unspa-worldplay/SKILL.md` locally, so they were never committed. The vitest `cli/skills/skills-sync.test.ts` enforces byte-identity between `cli/skills/` (canonical, ships via npm) and `.claude/skills/` (used when working on this repo), and a fresh CI clone was failing on the missing files. The published 0.1.6 npm tarball was always fine - `.claude/` is not in `package.json` `files`, so the package never carried those copies.

## [0.1.6] - 2026-05-27

Adds an experimental Vitest spec generator that closes the spec-vs-code loop - every authored scenario becomes a real unit test driven through a user-written adapter. Plus a small UX pass on tag filtering and the Projects index, and a README restructure for non-tech readability. All changes additive - no schema migration, safe to upgrade in place.

### Added

- **`unspa scenarios export <featureId>` (experimental).** Generates a Vitest spec from a feature's authored scenarios. The deterministic simulator runs each scenario at codegen time and embeds its predicted outcome (status + expected assertions) as the test oracle. The user writes a thin adapter - `UnspaAdapter` from `unspaghettit/cli/scenarios` - that calls their real implementation; the generated test drives every scenario through that adapter and asserts state path-by-path. Drift between authored `expectedStatus` and simulator prediction is reported per scenario but not gated (the generator emits tests as authored; the human picks which oracle wins). Default output is `./<feature-slug>.scenarios.spec.ts`; flags: `--out`, `--adapter`, `--adapter-export`, `--dry-run`, `--force`. Refuses to clobber an existing file without `--force`. Adapter contract (`UnspaAdapter`, `AdapterInvocation`, `AdapterResult`) is preview and may change between minor versions until the wedge graduates; every emitted file carries that banner in its header.

### Changed

- **Tag filter shows per-type color inside the dropdown.** Each `<optgroup>` gets a background-color tint at 28% of the type's color (a clear colored band on the type header) and each `<option>` beneath gets a lighter 12% wash. Text stays at default; the color reminder reads as a row-background swimlane that doesn't recolor labels. Replaces the inline `TagPillBar` chip row that used to render above the Projects, Features-in-Project, and global Features list views - the selector now carries the color signal alone.
- **Import .unspa button repositioned** to the top of the Projects index header, paired with the "Home" eyebrow. Mirrors the Export .unspa position on a project page and drops the heavier `h-10` styling for the same compact look used by Export.

### Documentation

- **README restructured for audience clarity.** Non-tech one-line hook ("a way to keep AI-assisted software aligned with what you actually meant"), MCP defined on first use with a link, "Who it's for" anchor, Quickstart vs Installation properly differentiated (no duplicate `npm install -g` block), Scenarios callout clarifies spec self-test (`run_all_scenarios`) vs code-vs-spec test (`unspa scenarios export`), Architecture section gains a runtime data-flow diagram before the folder tree, Status + Why-open-source merged into a single "Where this came from", Philosophy tightened from seven mixed-register lines to four consistent principles. Logo URL switched from the npm/jsDelivr CDN to `raw.githubusercontent` so it survives any future change to the npm `files` list.

### Migration

- None. The new CLI command is purely additive. The TagPillBar removal is internal - users who relied on the colored chip row above tag lists now see the same color information in the filter dropdown.

## [0.1.5] - 2026-05-25

Closes every silent-failure path on the report/sync side that 0.1.4 users hit, plus an interactive guided tutorial, project-level history, broader rule expressivity, and a UI / encoding pass. All changes additive - no schema migration, safe to upgrade in place.

### Added

- **Interactive guided tour from project to simulator.** New "Run interactive tutorial" button on the Tutorial page launches a 20-step spotlight tour that walks Project → Feature → Surface → Action → Parameter → Rule → Simulator, prefilling fields and gating each step on the right element being typed or clicked. Implemented as a hexagonal slice (TourStep / TourDefinition / SubmitGuard domain, SpecEventBus port, SharedSpecEventBusAdapter adapter, TourOverlay / TourPanel / TourSpotlight presentation). Required a handful of tour-supporting behavior on existing editors so prefilled content lands in genuinely-blank inputs: empty defaults on new editor rows, ParametersEditor auto-focus on new-row name input, and boolean param auto-seed to `false` so a default "No" registers as a value the validator can read.

- **Read-only project history tab.** The Y.Doc room serving each project already maintained a shared history log, but nothing on the client subscribed. The project page now renders that stream - same visual language as the feature-level HistoryPanel, intentionally stripped of `jumpTo` / `Clear` so a stray click can't time-travel a project out from under its features. Author chips reuse the AI / sys / user palette and surface `actingFor` for MCP-driven edits.

- **Parameters on the left of a rule condition.** `LeafRuleCondition.left` now accepts either a state path or `{ kind: 'param', name }`, so an action rule can branch on its own parameter without an intermediate state write. Threaded through Expression evaluation, FeatureValidator (param-left is action-rule only; rejected on surface rules + feature invariants because they have no parameter scope), MaturityScorer, the `get_action` MCP tool, and the RuleEditor / InvariantEditor UIs (State / Param toggle on the IF row).

- **Labeled MAT / IMPL chips on feature cards.** Replaces the single unlabeled "%" badge with two small stacked chips: `MAT 75%` (color-tiered emerald / amber / red against the maturity scorer) and `IMPL 50%` (same tier scheme when a `.unspa.json` report exists; muted grey "-" with explanatory tooltip when there's nothing taggable yet). Per-feature implementation status fetched lazily so each card updates in place once its report lands.

- **Cross-feature dedupe in project-level tabs.** When the same logical item lives in several features inside one project (a `users` table read by two flows, a `cart.cleared` event emitted from two features, …), the resources / entities / events / transitions tabs previously rendered one row per (feature, item) pair and the tab counter summed across - giving inflated numbers and visually duplicate rows. A new `crossFeatureGroups` service groups by identity (kind|provider|name for resources, namespace for entities, event name, from|to|label for transitions); each panel renders one row per unique item with a "From features" chip column.

- **Library chooser step on add-surface dialog.** Blank-surface creation used to live behind a `<details>` collapsible at the bottom of the template library - invisible unless you knew to look for it. The dialog now opens on a two-button chooser ("Create new" vs "From template"), each route leading to a focused step with a back arrow.

- **Easter eggs.** Type "spaghetti" or punch in the Konami code anywhere outside an input - a noodle drifts across the dashboard.

### Fixed

- **`sync_from_index` now surfaces orphan keys instead of silently skipping them.** Response carries an `orphans: { total, entries: [{ key, hint }] }` block listing every `.unspa.json` key that does not correspond to a spec entity. Each entry includes a targeted hint - slug-shaped ids on id-keyed types (e.g. `action:add-to-cart`) get "use 8-char hex from `get_behavioral_index`"; malformed keys (no `:` separator) get the parse error; the generic case explains the likely causes. `ok` is `false` when orphans are present, OR when `synced === 0` (100% failure to land anything is overwhelmingly misconfiguration, not a successful no-op) - neither situation can pass as success silently.

- **`report_implementation_status` / `_batch` returns `rejectedEntities` for unmatched ids.** Pre-0.1.5, when a `foundEntities[]` entry's `entityId` didn't match any spec entity (wrong format, removed entity, typo), the entry was silently bucketed into `extraTags`. The caller saw `foundCount: 0` with no diagnostic. Now each ack carries `rejectedEntities: [{ entityType, entityId, reason }]` (single-call) or `rejected[]` + `rejectedCount` (batch ack), each with an actionable per-entry reason. `ok: false` is returned whenever rejections are present. `extraTags` is now reserved for caller-supplied tags only.

- **`report_implementation_status` accepts state PATH or hex ID interchangeably.** Pre-0.1.5 state entities had to be reported by their hex id, but `get_implementation_gaps` and the `.unspa.json` index keyed them by path (e.g. `state:cart.itemCount`) - so the natural value the LLM had wasn't accepted, with no error. Now `entityType: "state"` matches on either form. Event entities continue to match on their literal name string (unchanged).

- **Documented behavioral-index key format matches the implementation.** The `CLAUDE.md` / `AGENTS.md` template (`cli/util/context-files.ts`) and both bundled skills (`unspa-implement`, `unspa-audit`) previously documented `action:<slug>` and `invariant:<slug>` - formats the spec never actually mints. They now correctly show `action:<id>` etc. with the 8-char hex contract spelled out and `get_behavioral_index` flagged as the way to look ids up. Existing 0.1.4 users will see the corrected docs the next time they run `unspa init`.

- **Tag chip close icon.** The remove button rendered a literal `Ã-` - UTF-8 bytes for `×` reinterpreted as CP1252 by a Windows editor pass. Swapped for an inline SVG so the glyph is encoding-proof, with `shrink-0` so the icon stops jumping when chips wrap.

- **Restored `cursor: pointer` on interactive elements.** Tailwind v4 Preflight changed the base cursor on `<button>`, `<select>`, `[role=button]` to `default`, making every clickable control feel like plain text. Restored in `@layer base` with a `:not(:disabled)` guard so existing `disabled:cursor-not-allowed` opt-ins keep winning.

- **Sync breadcrumb separator escape.** `formatChangeLabel` previously joined the breadcrumb path with literal `›` bytes that an editor round-trip had mangled to UTF-8-as-CP1252 (`â€º`). Every change since carried the corrupt bytes straight into the persisted Y.Doc history log. Runtime separator now uses the Unicode escape `'›'` so the source file stays ASCII-safe; SyncToast renders `&rsaquo;` for the same reason. Older entries on disk stay corrupt (history is immutable) but everything written from here is clean.

- **MCP server `version` no longer hardcoded.** `mcp-server/server.ts` advertised `0.1.2` in capability negotiation long after the package shipped 0.1.5. Now reads from `package.json` at module load.

### Improved

- **`get_implementation_gaps` exposes the canonical `entityId` per entry** (8-char hex id for state entities, alongside the existing path-shaped `key`). Removes the need for `get_feature(verbose:true)` just to look up a state id.
- **`get_implementation_gaps` returns a `hints[]` block** pointing at follow-up tools when the response calls for them: `get_neighborhood` for batching co-located implementation work; the path-or-id rule for state-entity reporting. Improves discoverability without forcing the LLM to read the full guide.

### Changed

- **Positioning reframed** as "Executable specifications for AI-assisted software development" across the tagline, meta tags, READMEs, tutorial prose, and contributor docs. Same product, sharper words.
- **MCP tool descriptions normalized to ASCII** - em-dashes and curly quotes → ASCII (`-`, `.`, `n/a`). LLM clients render tool descriptions as plain text, and encoding round-trips on the agent side were producing mojibake.
- **Feature card footer** says "X actions" instead of "X capabilities" to match the renamed model.
- **Repo encoding hygiene.** BOM-stripped CLI / docs / skills; mojibake stand-ins replaced with proper UTF-8 (`×`, `↔`, `§`, `›`); `.gitattributes` enforces LF on commit so Windows editor round-trips can't reintroduce CRLF + BOM drift. Most critical fix: `cli/util/context-files.ts` - the `unspa init` template that lands in every user's `CLAUDE.md` / `AGENTS.md` - carried a corrupt `~10Ã- larger` that was about to ship to every new user.

### Infrastructure

- **`scripts/sync-skills.cjs`.** `cli/skills/` is canonical - it's what `unspa init` ships into each user's repo. The same three skills also live under `.claude/skills/` so they apply when working on this repo. They drifted once already. The new script mirrors src → dest; `--check` mode fails byte-identical asserts on drift. Wired into `npm test` and `prepublishOnly` so a one-sided edit can never reach npm.

### Dependencies

- `@sveltejs/kit` → 2.61.0, `vite` → 8.0.14, `ws` → 8.21.0. CI `actions/checkout` → v6, `actions/setup-node` → v6.

### Migration

- None. 0.1.4 `.unspa.json` files with correct (hex) keys keep working unchanged. Files written against the old (incorrect) docs with slug-shaped keys now surface in `sync_from_index`'s `orphans` block with hints for fixing them. Code paths that read `extraTags` continue to work (the field is now narrower - caller-supplied only - but never grew unbounded with rejected entries in the first place).

## [0.1.0] - 2026-05-20

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

The Load samples button delivers an end-to-end **eShop** project (4 LLM-sized features: Account & auth, Catalog & reviews, Cart & checkout, Order fulfillment). Every feature scores 100% maturity. Designed to exercise the full capability surface - composite + Expression conditions, feature invariants, event cascade, `bypassInvariants`, action invariants, scenarios, persona overrides, entity/resource mapping.

### Known limitations

- The public contract - MCP tool surface, `.unspa.json` index format, snapshot JSON schema, dashboard REST API, CLI flags, and generated TypeScript types - is at v0.1. Breaking changes to any of these are signalled by a bump to `0.2.0`, so `"unspaghettit": "^0.1.x"` is safe to auto-upgrade.
