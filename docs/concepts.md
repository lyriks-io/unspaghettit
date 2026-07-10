# Core concepts

Unspaghettit gives humans and LLMs a shared, executable specification: a local, machine-checkable software design document that agents read and update through MCP (the Model Context Protocol, the open standard AI agents use to talk to local programs).

Instead of keeping product intent in long prompts or markdown that slowly goes stale, you model behavior as structured pieces. The MCP server exposes that model to your AI coding tool, so the LLM can inspect, simulate, edit, and audit it through typed tool calls instead of guessing from prose.

## The model

A project is built from a small set of entities:

- **Features**, the top-level units of behavior.
- **Surfaces**, where a feature is exposed.
- **Actions**, what a user or system can do.
- **State**, the data an action reads and writes.
- **Rules**, conditions that allow or block an action.
- **Invariants**, properties that must always hold.
- **Effects** and **events**, what happens after an action, including cascades.
- **Scenarios**, concrete step-by-step expectations.
- **Personas**, **resources**, and **entities** for mapping and overrides.

You don't author these by hand. You describe the product in plain language and the LLM builds the runtime through the MCP (`create_feature`, `apply_batch`, `add_action`, and so on). Validation errors come back inline, so the runtime converges instead of drifting.

A Feature is one coherent slice of behavior (a flow, a screen, a capability), sized so you can hold it in your head - roughly 1–15 surfaces. A whole product is a Project made of many Features.

## Scenarios are spec tests

This is the core idea. Every scenario you author is an executable assertion about behavior.

`run_all_scenarios` runs them through the deterministic simulator and reports pass or fail per assertion - a unit test suite for your spec, before any implementation exists.

Scenarios can be multi-step. A scenario's `steps[]` replays preceding actions (each through the simulator, threading state forward) before the action under test. So `run_all_scenarios` verifies whole flows - add to cart → apply coupon → checkout - not just single transitions.

`dry_run_simulate` runs a single action against a state snapshot when you want to probe one transition.

Specs stop being documentation. They become a runtime contract you can break loudly.

## Model checking: what example flows can't catch

Scenarios test the paths you thought of. `model_check` exhaustively explores the reachable state space (bounded) to find the ones you didn't:

- **Invariant counterexamples** with the shortest action path that reaches them.
- **Dead actions** that can never fire, **deadlocks**, and unreachable or terminal surfaces.
- **Reachability goals** - the liveness complement to invariants: `reachable` (a target state is achievable) and `always_reachable` (it stays reachable from everywhere, with a counterexample path to any trap).

Invariants come at three scopes: per-surface, feature-wide, and **cross-feature at the project level** (`projectInvariants`, e.g. "the orders feature's open count equals the billing feature's unpaid count" - something a feature invariant can't reference).

## Maturity scoring

`score_feature` returns a per-area score with critical and recommended issues. It surfaces the worst surfaces and the biggest gaps, so shallow modelling gets caught before it ships. `get_spec_gaps` lists what is still missing.

Maturity is a gate, not a vanity metric. 100% maturity is the recommended default for a first serious prompt because it pushes the agent to produce complete scenarios, rules, and checks instead of an outline. Lower it deliberately when you want brainstorming or a partial draft. See [Working with AI](prompting.md) for how to set the target.

Maturity measures the structure and depth of the model; it is not, by itself,
proof that every real-world behavior was discovered. Use verification and
source provenance alongside it. Standard-library blueprints are starter models:
they are intentionally rescored after insertion and may require domain-specific
permissions, rules, and scenarios.

For an evidence-first CI gate, run `unspa check --strict`. Strict mode enables
bounded model checking, requires scenarios, 100% maturity and verified code
coverage, rejects drift and invariant violations, and fails when exploration
skips an action or reaches its configured bounds. A strict pass is still scoped
to the authored model and the declared exploration bounds; it is not a claim
that undocumented behavior cannot exist.

## Generated TypeScript contracts

`generate_types` writes types for state shapes, event names, and action parameters. Your implementation imports them, so TypeScript catches drift the moment the spec changes. The compiler becomes your first line of defense against intent and code diverging.

## The audit index

Each implementation is recorded in a `.unspa.json` behavioral index: a `{ file, line, signature }` per spec entity. The MCP reconciles that index against the spec and reports coverage and gaps. The dashboard resolves it into a live map of what is implemented, what is missing, and what looks stale.

This is what makes drift visible. The spec knows where it lives in the code, so the moment the two disagree, you can see it. `get_drift` lists every implementation audited against an older spec than the one now on disk.

## Source provenance & codebase adoption

Provenance answers "where did this element come from?". When an agent extracts behavior from a document (a PRD, a brief, pasted notes), the original text is stored as an immutable, content-hash-deduplicated source in the project, and every extracted element is stamped with the exact span it was derived from. The dashboard's Source Viewer renders the text with each span highlighted and linked to its element, and `finalize_analysis` refuses to lock an analysis while any element is untraced, so the model cannot contain invented behavior.

Codebase adoption is the same discipline pointed at code (the code → spec direction). The agent attaches each source file it analyzed with `attach_source_path` (the server reads the file from disk itself, keeping token cost near that of plain modeling; `attach_source_file kind:"code"` remains the push variant), models what the code actually does, and batch-records a span for every element (`record_element_spans`). Then `seed_index_from_analysis` turns every code span into a `.unspa.json` entry ({file, line, signature}, spec version stamped), so one analysis pass yields the model, its provenance, and non-zero implementation coverage with drift detection armed. `unspa adopt` prints the paste-ready prompt for this flow; the bundled `unspa-adopt` skill runs it directly.

## Verified coverage (preview)

Coverage in the index is a *claim* - "this entity is implemented here." To turn it into proof, run the feature's scenarios against the real code:

```bash
unspa scenarios adapter <featureId>   # scaffold a thin adapter, one case per scenario-bearing action
unspa scenarios export  <featureId>   # generate a Vitest suite from the scenarios
vitest run --reporter=json            # run it against your implementation
unspa coverage ingest <report>        # stamp verifiedAt on actions whose scenarios all passed
```

The simulator's predictions are the oracle; a regression clears the stamp. `unspa check --min-verified <pct>` then gates the build on the proven share. Experimental - the adapter contract may shift between minor versions.

## One-command verification

`unspa check` runs the whole spine headlessly and exits non-zero on failure - scenarios + maturity + reachability + model checking + spec→code drift + cross-feature event coherence + verified coverage - so the spec becomes a CI gate, not a document (`--json` for dashboards). `unspa ci` scaffolds a GitHub Actions workflow that runs it on every push/PR. `verify` and `get_drift` are the in-chat MCP forms; the dashboard's **Verify** tab renders the verdict with navigable counterexample traces that deep-link to the violating action.

## The implementation queue

A per-project "implement next" list of Feature, Surface, and Action items. Reorder it by drag-and-drop in the dashboard. The LLM reads `mcp__unspa__get_next_queued`, so you can say "implement the next thing" without naming it. Items auto-prune as the behavioral index flips them to implemented.

## Capabilities at a glance

- **Structured behavior specification** - features, surfaces, actions, states, rules, invariants, transitions, scenarios, personas, resources, entities, events.
- **Code → spec adoption** - an LLM reads an existing repo, models its behavior with every element traced to the exact code span it came from, and `seed_index_from_analysis` wires the spec back to source automatically (`unspa adopt` / the `unspa-adopt` skill).
- **Source provenance** - documents and code files are stored immutably per project; every extracted element links back to the span it was derived from, browsable in the Source Viewer.
- **MCP-native** - every entity is created, read, edited, and validated through MCP tool calls. Works with any MCP-compatible IDE.
- **Deterministic simulator & bounded model checking** - single transitions, whole-flow scenarios, and exhaustive state-space exploration.
- **Safety + liveness properties** - invariants per-surface / feature / project, plus reachability goals.
- **One-command verification gate** - `unspa check` / `verify` fold the whole spine into a single pass/warn/fail.
- **Maturity scoring** - per-area scores with critical and recommended issues.
- **Generated TypeScript contracts** - types for state, events, and parameters.
- **Implementation audit** - `.unspa.json` records where each entity lives and reports coverage + gaps.
- **Implementation queue** - per-project "implement next" list.
- **Local-first** - everything lives in your repo. No telemetry, no hosted servers. Snapshots are plain JSON.
- **Multi-agent ready** - Yjs WebSocket server for real-time multi-human / multi-agent editing, with `AI · for John` attribution.
- **Encrypted backup / share** - passphrase-encrypted project bundles.

## Philosophy

- **Local-first.** Your repo holds the truth. No accounts, no telemetry, no hosted service.
- **Simulation before implementation.** Prove the spec is internally consistent before writing the code that implements it.
- **Explicit structure over prompt heuristics.** Humans and LLMs collaborate on the model, not on free-form prose.
- **Deterministic logic in the spec; judgment in the humans.** The runtime owns the gates and consequences. Humans (and LLMs as their agents) own taste, scope, and the parts that don't compress.
