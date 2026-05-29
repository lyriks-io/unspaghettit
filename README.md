<p align="center">
  <img src="https://raw.githubusercontent.com/lyriks-io/unspaghettit/main/static/unspaghettit_logo.png" alt="Unspaghettit" width="120" />
</p>

<h1 align="center">Unspaghettit</h1>

<p align="center">
  <em>Executable specifications for AI-assisted software development.</em>
</p>

<p align="center">
  <a href="https://github.com/lyriks-io/unspaghettit/actions/workflows/ci.yml">
    <img src="https://github.com/lyriks-io/unspaghettit/actions/workflows/ci.yml/badge.svg" alt="CI" />
  </a>
  <a href="https://www.gnu.org/licenses/agpl-3.0.html">
    <img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL-3.0" />
  </a>
  <a href="https://nodejs.org/">
    <img src="https://img.shields.io/badge/node-%E2%89%A520.10-43853d.svg" alt="Node ≥ 20.10" />
  </a>
</p>

<p align="center">
  Local-first &nbsp;·&nbsp; MCP-native &nbsp;·&nbsp; AGPL-3.0
</p>

<p align="center">
  <em>An open-source project by <a href="https://lyriks.io">Lyriks.io</a>.</em>
</p>

---

## Why Unspaghettit?

AI coding works best when the human and the LLM share a stable model of the product. Without one, specs drift, prompts pile up, generated systems lose coherence, and important assumptions live only in chat history.

In one line: **a way to keep AI-assisted software aligned with what you actually meant.**

## What it does

Unspaghettit gives humans and LLMs a shared, **executable specification** for the systems they build together: a local, machine-checkable software design document that agents can read and update through MCP (the [Model Context Protocol](https://modelcontextprotocol.io) — how AI tools like Claude, Cursor, and Gemini talk to local programs).

Instead of keeping product intent in long prompts or markdown that slowly goes stale, you model the behavior as structured pieces: features, surfaces, actions, state, rules, effects, events, invariants, and scenarios. The MCP server exposes that specification to your AI coding tool, so the LLM can inspect, simulate, edit, and audit the model through typed tool calls instead of guessing from prose.

You can use it in both directions: start from an idea and drive **spec → code**, or point an LLM at an existing codebase and build a **code → spec** map that makes the current behavior explicit.

The specification becomes the source of truth; prompts become disposable again.

## Who it's for

- **Solo developers** shipping with an AI assistant who want product intent to survive between chat sessions.
- **Small teams** where multiple humans and agents touch the same codebase and need a shared, versioned model of "what the product does".
- **Technical founders / product-minded engineers** who want a machine-readable spec they can hand to an LLM and get an honest report back.
- **Anyone with an existing codebase** that's drifted from its docs and wants the LLM to rebuild the spec from the code itself.

## Benefits

- **Less drift between intent and code**: scenarios, generated types, and implementation coverage all point back to the same spec.
- **Existing code becomes legible**: ask an LLM to reverse-map a codebase into features, actions, scenarios, and implementation coverage.
- **AI agents get structured context**: the LLM reads focused entities and actions instead of a giant prompt blob.
- **Specs become testable**: every scenario can run through the simulator before implementation exists.
- **Implementation stays auditable**: `.unspa.json` records where each spec entity is implemented and reports gaps.
- **Teams keep local ownership**: snapshots are plain JSON in your repo or local hub, with no hosted service required.

## Quickstart

From nothing to a running Unspaghettit workspace:

```bash
npm install -g unspaghettit
cd path/to/your-app
unspa init
unspa dashboard
```

`unspa init` wires the MCP server into the AI clients you choose. If your client supports skills or custom instructions, it can install the Unspaghettit guidance there too.

Restart your IDE or AI client. When it comes back up, accept the MCP server and the guidance if your client asks. Then ask your LLM something like:

```text
Using the Unspaghettit MCP, create a new project.
Model the first feature and make it implementation-ready.
```

The dashboard opens at `http://localhost:3000`, so you can watch the spec take shape while the LLM works.

New to this? Hit `/tutorial` in the dashboard for a guided walkthrough (Project → Feature → Surface → Action → Parameter → Rule → Simulator, step by step).

For the full list of supported AI clients, the `unspa init` flags, and the shared-hub layout for multi-repo setups, jump to [Installation](#installation-clients-flags-advanced-setup).

## Scenarios as executable spec tests

The strongest idea in here, surfaced up front:

> Every scenario you author is an **executable assertion** about behavior. `run_all_scenarios` runs them through the deterministic simulator and reports pass/fail per assertion — a unit test suite for the spec itself, before the implementation exists.

Two complementary uses of the same scenarios:

- **Spec self-test (always on).** `run_all_scenarios` checks that the spec is internally consistent: every scenario's expected outcome matches what the simulator computes from the rules. Catches contradictions in product logic before a line of code is written.
- **Code-vs-spec test (preview).** `unspa scenarios export <featureId>` generates a Vitest file from those same scenarios, using the simulator's predictions as the oracle. You write one thin adapter (`UnspaAdapter` from `unspaghettit/cli/scenarios`) that calls your real implementation; the generated tests drive every scenario through it and assert state path-by-path. Experimental — adapter contract may shift between minor versions.

Scenarios can be **multi-step**: a scenario's `steps[]` replays preceding actions (each through the simulator, threading state forward) before the action under test, so `run_all_scenarios` verifies whole flows — add to cart → apply coupon → checkout — not just single transitions.

Specs stop being documentation. They become a runtime contract you can break loudly.

## Core capabilities

- **Structured behavior specification**, features, surfaces, actions, states, rules, invariants, transitions, scenarios, personas, resources, entities, events.
- **Code → spec mapping**, an LLM can read an existing repo, model its behavior into an Unspaghettit runtime, and wire the spec back to source files through the behavioral index.
- **MCP-native**, every entity is created, read, edited, and validated through MCP tool calls. Works with any MCP-compatible IDE (Claude Code, Claude Desktop, Cursor, Gemini, Windsurf, Kiro, Codex).
- **Deterministic simulator**, `dry_run_simulate` runs an action against a state snapshot. `run_all_scenarios` runs every scenario as a deterministic spec test, with pass/fail per assertion.
- **Maturity scoring**, `score_feature` returns a per-area score with critical/recommended issues; surfaces the worst surfaces and biggest gaps.
- **Generated TypeScript contracts**, `generate_types` writes types for state shapes, event names, and action parameters. Your implementation imports them, so TypeScript catches drift when the spec changes.
- **Implementation audit**, record each implementation in a `.unspa.json` behavioral index (`{ file, line, signature }` per entity); the MCP reconciles it against the spec and reports coverage + gaps.
- **Implementation queue**, per-project "implement next" list (Feature / Surface / Action items). Drag-and-drop reorder in the dashboard, `mcp__unspa__get_next_queued` so a dev says "implement the next thing" without naming it. Auto-prunes items the behavioral index marks done.
- **Local-first**, everything lives in your repo. No telemetry, no hosted servers, no cloud dependency. Snapshots are plain JSON.
- **Multi-agent ready**, built-in Yjs WebSocket server lets multiple humans and/or LLMs edit the same runtime in real time. History entries carry `AI · for John` attribution so MCP-driven changes are distinguishable from direct human edits.
- **Encrypted backup / share**, the project page's **Export .unspa** button bundles project + features + status sidecars into a single passphrase-encrypted file. Passphrase never leaves the browser; envelope carries no identifier of contents. See [Security tiers](#security-tiers).

## Workflows

### Spec → code

1. Describe what you want to your LLM.
2. The LLM builds the runtime via the MCP, `create_feature`, `apply_batch`, `add_action`, etc. Validation errors come back inline so the runtime converges.
3. Author scenarios. `run_all_scenarios` makes them executable spec tests.
4. `generate_types` writes TypeScript contracts from the spec.
5. The LLM implements the feature using those types and the scenario results as checks. The `.unspa.json` index maps each spec entity to a `{ file, line, signature }` so the dashboard can resolve coverage.
6. `score_feature` and `get_spec_gaps` catch shallow modelling before it ships.

### Code → spec

1. The LLM reads your existing code.
2. It builds an Unspaghettit runtime that describes the code's behavior, batch by batch.
3. `score_feature` and `get_spec_gaps` show where the runtime is still shallow.
4. Iterate until the runtime audits cleanly.
5. The `.unspa.json` index wires the runtime back to the source so future drift is visible.

The LLM does the reading/writing in both directions. Unspaghettit gives it a structured target and a maturity gate.

## Working with the MCP in chat

Ready-to-paste prompt patterns for the common tasks: starting a new project, choosing a maturity level, asking questions about an existing spec, editing it, and moving from spec to implementation. Skim the subheadings and jump to the one you need.

Once `unspa init` has registered the MCP server and your AI client has restarted, you do not need to speak in Unspaghettit internals. Start with the product you want. Mention the Unspaghettit or Unspa MCP, the scope, and the level of completeness you want. For a first prompt, asking for 100% maturity usually gives a much better result because it pushes the agent to create complete scenarios, rules, and checks instead of a shallow outline.

### Start with a prompt

For a new product, this is usually enough:

```text
Using the Unspaghettit MCP, create a new project.
It is a mobile app that lets a user get one coupon each day for a shop near them.
Make each feature reach 100% maturity.
```

If you want a smaller first pass:

```text
Using the Unspa MCP, create a new project for a B2B invoicing app.
Start with three features only: customers, invoices, and payment follow-up.
Make it a solid first draft, not necessarily 100% maturity yet.
Ask me if a business rule is unclear.
```

For one feature:

```text
Using the Unspaghettit MCP, add a feature for approving refunds.
Keep it focused on the support agent workflow.
Make it implementation-ready and bring it to 100% maturity.
```

For an existing codebase:

```text
Using the Unspaghettit MCP, read this repository and create a spec that describes the behavior already implemented.
Start with the most important user-facing flows.
Map each spec entity back to the files that implement it, then report what is unclear or missing.
```

### Choose the maturity level

100% maturity is the recommended default for a first serious prompt. It helps the agent produce a richer spec on the first pass. Lower the target only when you explicitly want brainstorming, discovery, or a partial draft.

```text
Make this a rough product draft. Do not force 100% maturity yet.
I want enough structure to discuss the flow and discover missing business rules.
```

```text
Make this implementation-ready. Aim for 100% maturity.
If anything prevents 100%, explain the missing product decision instead of inventing it.
```

```text
Do not chase the score blindly. Prefer a clear product spec.
If a maturity check feels artificial for this feature, tell me why.
```

### Ask questions about the spec

The MCP is also useful as a query layer. Ask the agent to inspect the current model instead of relying on memory or screenshots.

```text
Using the Unspaghettit MCP, explain the Cart & checkout feature.
Explain what the user can do, what can block them, and what happens after each important action.
```

```text
What can block Place order?
Explain each blocker in product language and tell me which cases are already covered by scenarios.
```

```text
Where is email verification used in this project?
Tell me what depends on it and what would change if we removed that requirement.
```

```text
Using the Unspaghettit MCP, make a report of the current implementation of the specs in this codebase.
Tell me what is implemented, what is missing, and what looks stale.
```

### Change or extend the spec

You can ask for changes in normal product language. Add constraints when they matter.

```text
Using the Unspaghettit MCP, add a "Cancel subscription" flow.
Reuse the existing billing concepts when possible.
After the edit, tell me whether the maturity score changed and why.
```

```text
Before changing the spec, propose the change in plain English.
Once I approve, update the Unspaghettit project and run the relevant scenarios.
```

### Move from spec to implementation

If you want code, say so in the same prompt. Include design, stack, and implementation constraints if they matter.

```text
Using the Unspaghettit MCP, implement the next queued feature.
Use the existing SvelteKit style and keep the UI quiet and mobile-friendly.
After implementation, update the implementation report for the spec.
```

```text
Using the Unspa MCP, implement the coupon discovery feature.
Use the current app stack. If the spec is missing something needed for implementation,
update the spec first, then write the code.
```

Good first prompt pattern: mention the Unspaghettit MCP, describe the product, set the maturity level, and say whether you want spec only or spec plus implementation.

## What makes it different

Unspaghettit is a local, executable specification layer for AI-assisted development. It gives the LLM durable project memory that can be validated, simulated, scored, and mapped back to source code.

That makes it different from:

- markdown prompt workflows, which are easy to write but cannot execute or report drift,
- autonomous agent frameworks, which decide how work gets done but usually do not model product behavior as a contract,
- hosted AI wrappers, which add a service boundary instead of keeping the source of truth in your repo,
- no-code platforms, which own the implementation path,
- code generators, because Unspaghettit generates contracts and audit data while your LLM or team writes the actual code.

## Philosophy

- **Local-first.** Your repo holds the truth. No accounts, no telemetry, no hosted service.
- **Simulation before implementation.** Prove the spec is internally consistent before writing the code that implements it.
- **Explicit structure over prompt heuristics.** Humans and LLMs collaborate on the model, not on free-form prose.
- **Deterministic logic in the spec; judgment in the humans.** The runtime owns the gates and consequences. Humans (and LLMs as humans' agents) own taste, scope, and the parts that don't compress.

## Installation (clients, flags, advanced setup)

> The 30-second path is in [Quickstart](#quickstart) above. This section covers which AI clients are supported, the flags `unspa init` accepts, and the shared-hub layout for multi-repo setups.
>
> Developing on the CLI itself? Clone the repo, then `npm install && npm run build && npm link`. See [cli/README.md](cli/README.md) for the dev setup.

### Supported AI clients

`unspa init` registers the MCP server with the AI clients you pick. Supported out of the box:

| Client                   | Project config                  | Global config                          |
| ------------------------ | ------------------------------- | -------------------------------------- |
| Claude Code (CLI + VSC)  | `.mcp.json`                     | `~/.claude.json`                       |
| Claude Desktop           | n/a (no project scope)          | `%APPDATA%\Claude\claude_desktop_config.json` (Windows) / `~/Library/Application Support/Claude/...` (macOS) |
| Cursor                   | `.cursor/mcp.json`              | `~/.cursor/mcp.json`                   |
| Gemini Code Assist / CLI | `.gemini/settings.json`         | `~/.gemini/settings.json`              |
| Windsurf                 | n/a                             | `~/.codeium/windsurf/mcp_config.json`  |
| Kiro                     | `.kiro/settings/mcp.json`       | `~/.kiro/settings/mcp.json`            |
| Codex (VS Code)          | prints snippet to paste manually | (manual paste)                        |

For Codex (and any other client without an automated config write), `unspa init` prints the MCP JSON snippet to copy into the client's settings.

Re-running `unspa init` is safe, every step is idempotent. Existing entries are preserved; managed blocks refresh in place.

You normally don't run the MCP server manually — your AI client spawns `unspa-mcp` on demand. `unspa serve` exists as a debugging hatch if you ever need to test the stdio interface yourself.

### Where the model lives (shared hub by default)

`unspa init` needs no decision about storage: the behavior model lives in a **shared hub** at `~/.unspa-hub/unspa`, and both the MCP server and `unspa dashboard` discover it automatically on the first run — no `UNSPA_SNAPSHOTS`, no special launch directory. One source of truth across every repo and every client (including **Claude Desktop**, which has no project scope), and one `unspa dashboard` run from anywhere serves it.

Want the model versioned **inside a specific repo** instead — travelling in git and PRs? Opt into a per-repo install:

```bash
unspa init --local            # scaffold this repo's unspa/ folder (found by walk-up)
unspa init --custom           # interactive: hub vs per-repo vs custom path
unspa init --hub /custom/path # a non-default hub location (pins UNSPA_SNAPSHOTS)
```

Discovery order, used by both the MCP and the dashboard: explicit `UNSPA_SNAPSHOTS` / `--snapshots` → a per-repo `unspa/` found by walking up from the launch directory → the shared hub. So a per-repo `unspa/` always wins when present, and everything else falls back to the hub.

Switching later is just a re-run: `unspa init` for the hub, `unspa init --local` for per-repo, or `unspa dashboard --snapshots <path>` for a one-off look at any folder. All loopback / single-machine; the hub is not a network service.

For the CLI details (commands, flags, troubleshooting), see [cli/README.md](cli/README.md).

## Example

Boot `unspa dashboard` and click **Load samples** to install the bundled **eShop** project. It includes 4 features — Account & auth, Catalog & reviews, Cart & checkout, and Order fulfillment — each small enough for an agent to reason about end to end.

The sample is intentionally complete: scenarios, rules, invariants, events, personas, entities, resources, and implementation mapping are all represented. Every feature scores 100% maturity, so it works as a clean reference model. To see maturity gaps, create a tiny scratch feature with an empty surface or an action without effects/scenarios; the dashboard will show the missing pieces.

If you'd rather follow a guided tour than poke at the sample, the dashboard's `/tutorial` page also has a 14-section written walkthrough and a **Run interactive tutorial** button that drives a spotlight tour through Project → Feature → Surface → Action → Parameter → Rule → Simulator, prefilling fields along the way.

## Collaboration

Multiple humans + AI agents can edit the same runtime live:

- **Real-time sync**, every dashboard tab subscribes to a per-room Yjs WebSocket. Out-of-band changes (MCP writes, other tabs) flow in without a reload, with an activity toast for each change carrying a breadcrumb path (`Project › Feature › Surface › Action`) and a "View" button.
- **Identity**, click the round avatar in the header to set your display name. Every history entry you create is tagged with it. Stored in browser localStorage, never sent off-machine. First visit prompts once; the avatar dropdown is the explicit way to change or reset later.
- **Attribution**, MCP-driven changes carry an `AI · for John` label, so the history shows both the agent and the human it is working with.
- **Project history**, read-only timeline tab on the project page lists every change (rename, feature add/remove, queue mutation, …) with author + timestamp. The shared per-project room feeds it, so MCP edits and human edits land in the same audit log.
- **Implementation queue**, drag-and-drop "implement next" list per project. The LLM uses `mcp__unspa__get_next_queued` so you can say "implement the next thing" without naming it. Items auto-prune as `.unspa.json` flips them to `implemented`.
- **Backup / share**, the project page's **Export .unspa** button produces an encrypted bundle (project + features + status). The matching **Import .unspa** on the projects index restores it. Passphrase is required on both ends; the file itself reveals nothing about its contents.

## Security tiers

Unspaghettit is local-first by default. Three tiers, all opt-in beyond the default:

| Tier | Setup | What it covers |
|---|---|---|
| **Default** | `unspa dashboard` | Loopback bind (`127.0.0.1:3000`). No auth, no telemetry, no callhome. Single-machine trust boundary. |
| **LAN-share** | `UNSPA_AUTH_TOKEN=<secret>`, optionally `UNSPA_ALLOWED_ORIGIN=http://host:3000`, then `unspa dashboard --host 0.0.0.0` | Every REST + WebSocket request requires the token. Origin allowlist closes browser-side CSRF. Set the **same** `UNSPA_AUTH_TOKEN` on the MCP server's env so its notify calls authenticate. The dashboard prints the auth posture in its startup banner. |
| **Backup / share** (orthogonal to live sharing) | Click **Export .unspa** on a project, enter a passphrase ≥ 8 chars | AES-GCM-256 + PBKDF2-SHA256 (600k iterations). Passphrase never leaves the browser. Envelope carries no project name or metadata. |

Full threat model + mitigations in [SECURITY.md](SECURITY.md).

## Architecture

How the pieces fit at runtime:

```
                         ┌──────────────────────────┐
  AI client              │  MCP server (stdio)      │
  (Claude / Cursor / ───→│  - typed tool surface    │←─── your code
  Gemini / ...)          │  - validation + simulator│     (via .unspa.json
                         └────────────┬─────────────┘      behavioral
                                      │                    index)
                                      ▼
                         ┌──────────────────────────┐
                         │  unspa/  (or hub)        │
                         │  feature JSON snapshots  │←──→ Yjs WebSocket
                         │  = your runtime          │     (live multi-agent)
                         └────────────┬─────────────┘
                                      │
                                      ▼
                         ┌──────────────────────────┐
                         │  SvelteKit dashboard     │
                         │  (you, browsing the spec)│
                         └──────────────────────────┘
```

The spec is just JSON on disk. The MCP server, the dashboard, your AI client, and your application code all read and write through it. Nothing is hosted; everything is in your repo (or in a local hub you control).

Where the code lives:

```
unspaghettit/
├── unspa/                        ← feature JSON snapshots (your runtime; empty on a fresh clone)
├── samples/                      ← bundled sample projects (one folder per project, e.g. eshop/)
├── mcp-server/                   ← MCP server (stdio)
├── src/                          ← SvelteKit dashboard + domain
│   ├── features/behavior-model/  ← Feature/Surface/Action entities + transforms
│   ├── features/simulator/       ← deterministic simulator
│   └── features/mcp-tools/       ← read-side tool implementations
├── cli/                          ← `unspa` command (init / serve / dashboard)
└── build/                        ← SvelteKit production build (npm run build)
```

## Where this came from

Built internally at Lyriks because existing AI workflows were becoming increasingly hard to reason about as systems grew. The runtime became useful enough that we released it as standalone OSS — AGPL-licensed and separate from other Lyriks research work.

Early but functional. Used internally to model products, generate typed scaffolding, audit implementation against spec, run multi-agent editing sessions, and recursively refine the runtime itself.

## Definitely Do Not Use This For Fun

*(RPG quests, interactive fiction, narrative worlds, tabletop campaign logic — for the avoidance of doubt.)*

If you have read this far, one final piece of very serious advice.

Under no circumstances should you try using Unspaghettit to model RPG quests, branching stories, interactive fiction, tabletop campaign logic, NPC behavior, faction states, mystery plots, puzzle chains, or alternate endings — any narrative system where choices, rules, consequences, and world state need to stay coherent.

You might discover that executable specs are suspiciously good at checking whether a dragon deal can be broken, whether a locked door can be opened before the key exists, whether two endings contradict each other, or whether your "simple little side quest" has quietly become a state machine with twelve emotional failure modes.

There are two halves. **Building** the world maps locations to surfaces, world state to shared state, NPC schedules to time-driven rules, and "what the player can do here" to actions with preconditions. **Playing** the world is the dangerous part: a chat reads a saved game file on every turn, maps the player's intent to a modeled action, asks the deterministic simulator to resolve it, applies the diff back to disk, and narrates the result. The save file is canonical — your inventory, time of day, and current location survive the LLM forgetting the conversation.

It will probably not become the fastest game ever made, but it may become a strangely coherent one. Unspaghettit holds the deterministic logic: the rules, the gates, the consequences, the world state. The LLM gets all the room it needs to invent everything that should stay human-shaped: emotion, atmosphere, dialogue, visual design, awkward silences, suspicious taverns, bad decisions, and the exact kind of rain that falls before a betrayal.

Unspaghettit does not know how to be human. That is not its job. But for deterministic logic, it is a menace.

The two skills that make this possible (`unspa-worldbuild` and `unspa-worldplay`) are experimental and opt-in. The `unspa init` flow asks before installing them, or you can pass `--fun` to pre-check the box. (You may also notice the package publishes a longer bin alias — `unspaghettit` instead of `unspa`. Try invoking that name. Just don't tell anyone.)

This would be extremely dangerous, because you may have fun.

---

## License

AGPL-3.0. You're free to use, study, modify, and self-host. Improvements and derivative networked versions stay open under the same license. See [LICENSE](LICENSE).

Enterprise-grade support and private commercial setups are available via `hello@lyriks.io`. Everything in this repo stays open under AGPL.
