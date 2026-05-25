<p align="center">
  <img src="https://cdn.jsdelivr.net/npm/unspaghettit/static/unspaghettit_logo.png" alt="Unspaghettit" width="120" />
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

## The problem

AI coding workflows go sideways fast. Specs drift. Prompts pile up. Generated systems lose coherence. Most current tools rely on markdown specs, giant prompts, disposable chat history, and implicit assumptions nobody can audit.

## What it does

Unspaghettit gives humans and LLMs a shared, **executable specification** for the systems they build together. If you think in terms of SDD, treat it as a local, machine-checkable software design document that agents can read and update through MCP.

Instead of keeping product intent in long prompts or markdown that slowly goes stale, you model the behavior as structured pieces: features, surfaces, actions, state, rules, effects, events, invariants, and scenarios. The MCP server exposes that specification to your AI coding tool, so the LLM can inspect, simulate, edit, and audit the model through typed tool calls instead of guessing from prose.

The specification becomes the source of truth; prompts become disposable again.

## Benefits

- **Less drift between intent and code**: scenarios, generated types, and implementation coverage all point back to the same spec.
- **AI agents get structured context**: the LLM reads focused entities and actions instead of a giant prompt blob.
- **Specs become testable**: every scenario can run through the simulator before implementation exists.
- **Implementation stays auditable**: `.unspa.json` records where each spec entity is implemented and reports gaps.
- **Teams keep local ownership**: snapshots are plain JSON in your repo or local hub, with no hosted service required.

## Scenarios as CI-grade spec tests

The strongest idea in here, surfaced up front:

> Every scenario you author is an **executable assertion** about behavior. `run_all_scenarios` runs them through the deterministic simulator and reports pass/fail per assertion, like a unit test suite for your spec, before a line of implementation exists.

Specs stop being documentation. They become a runtime contract you can break loudly.

## Core capabilities

- **Structured behavior specification**, features, surfaces, actions, states, rules, invariants, transitions, scenarios, personas, resources, entities, events.
- **MCP-native**, every entity is created, read, edited, and validated through MCP tool calls. Works with any MCP-compatible IDE (Claude Code, Claude Desktop, Cursor, Gemini, Windsurf, Kiro, Codex).
- **Deterministic simulator**, `dry_run_simulate` runs an action against a state snapshot. `run_all_scenarios` executes every scenario as a CI-grade spec test, with pass/fail per assertion.
- **Maturity scoring**, `score_feature` returns a per-area score with critical/recommended issues; surfaces the worst surfaces and biggest gaps.
- **Generated TypeScript contracts**, `generate_types` writes types for state shapes, event names, and action parameters. Your implementation imports them, so TypeScript catches drift when the spec changes.
- **Implementation audit**, record each implementation in a `.unspa.json` behavioral index (`{ file, line, signature }` per entity); the MCP reconciles it against the spec and reports coverage + gaps.
- **Implementation queue**, per-project "implement next" list (Feature / Surface / Action items). Drag-and-drop reorder in the dashboard, `mcp__unspa__get_next_queued` so a dev says "implement the next thing" without naming it. Auto-prunes items the behavioral index marks done.
- **Local-first**, everything lives in your repo. No telemetry, no hosted servers, no cloud dependency. Snapshots are plain JSON.
- **Multi-agent ready**, built-in Yjs WebSocket server lets multiple humans and/or LLMs edit the same runtime in real time. History entries carry `AI · John` attribution so MCP-driven changes are distinguishable from direct human edits.
- **Encrypted backup / share**, the project page's **Export .unspa** button bundles project + features + status sidecars into a single AES-GCM-256 / PBKDF2-SHA256 file. Passphrase never leaves the browser; envelope carries no identifier of contents.

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

Once `unspa init` has registered the MCP server and your AI client has restarted, you do not need to speak in Unspaghettit internals. Start with the product you want. Mention the Unspaghettit or Unspa MCP, the scope, and the level of completeness you want. For a first prompt, asking for 100% maturity usually gives a much better result because it pushes the agent to create complete scenarios, rules, and checks instead of a shallow outline.

### Start with a product prompt

This is usually enough:

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

- Local-first.
- Explicit behavior over prompt heuristics.
- Simulation before implementation.
- Humans and LLMs collaborate on structure, not on free-form prose.
- Runtime validation over prompt guessing.
- No prompt spaghetti.

## Quickstart

Install the CLI globally:

```bash
npm install -g unspaghettit
```

Then in any project you want to wire up:

```bash
cd path/to/your-app
unspa init           # interactive: scaffold unspa/ + register MCP + seed CLAUDE.md/AGENTS.md + install skills
unspa dashboard      # opens http://localhost:3000
```

> Developing on the CLI itself? Clone the repo, then `npm install && npm run build && npm link`. See [cli/README.md](cli/README.md) for the dev setup.

`unspa init` registers the MCP server with the AI clients you pick. Supported out of the box:

| Client                   | Project config                  | Global config                          |
| ------------------------ | ------------------------------- | -------------------------------------- |
| Claude Code (CLI + VSC)  | `.mcp.json`                     | `~/.claude.json`                       |
| Claude Desktop           | n/a (no project scope)          | `%APPDATA%\Claude\claude_desktop_config.json` (Windows) / `~/Library/Application Support/Claude/...` (macOS) |
| Cursor                   | `.cursor/mcp.json`              | `~/.cursor/mcp.json`                   |
| Gemini Code Assist / CLI | `.gemini/settings.json`         | `~/.gemini/settings.json`              |
| Windsurf                 | n/a                             | `~/.codeium/windsurf/mcp_config.json`  |
| Kiro                     | `.kiro/settings/mcp.json`       | `~/.kiro/settings/mcp.json`            |
| Codex (VS Code)          | prints snippet to paste manually | same                                  |

For the manual entries, `unspa init` prints the MCP JSON snippet to copy into the client's MCP settings.

Re-running `unspa init` is safe, every step is idempotent. Existing entries are preserved; managed blocks refresh in place.

Restart your IDE. Your LLM now has the runtime's full tool surface.

### Shared snapshot hub

By default `unspa init` scaffolds a per-repo `unspa/` folder. For workflows where you want **one source of truth across many repos**, or where you want to attach **Claude Desktop** (which has no project scope and no useful launch cwd), use a shared hub:

```bash
unspa init --hub              # default hub at ~/.unspa-hub/unspa
unspa init --hub /custom/path # override the location
```

In hub mode:

- No local `unspa/` is created in the repo.
- Every selected client's MCP entry carries `UNSPA_SNAPSHOTS=<absolute hub path>`, so the MCP always reads/writes the hub regardless of where the client launches it.
- One `unspa dashboard` run from the hub root serves the same data every client sees.

End state: Claude Desktop for cross-project querying, per-repo Claude Code instances pointed at the same hub via the env var (and bound to one project each via `unspa link`), and one live dashboard reflecting every change. All loopback / single-machine; the hub is not a network service.

For the CLI details (commands, flags, troubleshooting), see [cli/README.md](cli/README.md).

## Example

Boot `unspa dashboard` and click **Load samples** to install the bundled **eShop** project: 4 LLM-sized features (Account & auth, Catalog & reviews, Cart & checkout, Order fulfillment) that exercise the full capability surface, composite + Expression conditions, feature invariants, event cascade, `bypassInvariants`, action invariants, scenarios, persona overrides, entity/resource mapping. Every feature scores 100% maturity so the sample works as a clean reference model. To see maturity gaps, create a tiny scratch feature with an empty surface or an action without effects/scenarios; the dashboard will show the missing pieces.

The dashboard also ships a **Tutorial** page (`/tutorial`) with a 14-section walkthrough and a **Run interactive tutorial** button that drives a guided spotlight tour from project → feature → surface → action → parameter → rule → simulator, prefilling fields and gating each step on the right thing being typed/clicked.

## Collaboration

Multiple humans + AI agents can edit the same runtime live:

- **Real-time sync**, every dashboard tab subscribes to a per-room Yjs WebSocket. Out-of-band changes (MCP writes, other tabs) flow in without a reload, with an activity toast for each change carrying a breadcrumb path (`Project › Feature › Surface › Action`) and a "View" button.
- **Identity**, click the round avatar in the header to set your display name. Every history entry you create is tagged with it. Stored in browser localStorage, never sent off-machine. First visit prompts once; the avatar dropdown is the explicit way to change or reset later.
- **Attribution**, MCP-driven changes carry an `AI · for John` label (the AI badge stays primary; the human name is the supporting attribution). Resolved server-side from whoever's currently at the dashboard.
- **Project history**, read-only timeline tab on the project page lists every change (rename, feature add/remove, queue mutation, …) with author + timestamp. The shared Y.Doc room feeds it, so MCP edits and human edits land in the same audit log.
- **Implementation queue**, drag-and-drop "implement next" list per project. The LLM uses `mcp__unspa__get_next_queued` so you can say "implement the next thing" without naming it. Items auto-prune as `.unspa.json` flips them to `implemented`.
- **Backup / share**, the project page's **Export .unspa** button produces an encrypted bundle (project + features + status). The matching **Import .unspa** on the projects index restores it. Passphrase is required on both ends; the file itself reveals nothing about its contents.

## Security tiers

Unspaghettit is local-first by default. Three tiers, all opt-in beyond the default:

| Tier | Setup | What it covers |
|---|---|---|
| **Default** | `unspa dashboard` | Loopback bind (`127.0.0.1:3000`). No auth, no telemetry, no callhome. Single-machine trust boundary. |
| **LAN-share** | `UNSPA_AUTH_TOKEN=<secret>`, optionally `UNSPA_ALLOWED_ORIGIN=http://host:3000`, then `unspa dashboard --host 0.0.0.0` | Every REST + WebSocket request requires the token. Origin allowlist closes browser-side CSRF. Set the **same** `UNSPA_AUTH_TOKEN` on the MCP server's env so its notify calls authenticate. The dashboard prints the auth posture in its startup banner. |
| **Backup / share** (orthogonal to live sharing) | Click **Export .unspa** on a project, enter a passphrase ≥ 8 chars | AES-GCM-256 + PBKDF2-SHA256 (600k iterations). Passphrase never leaves the browser. Envelope carries no project name or metadata. |

Full threat model + mitigations in [SECURITY.md](SECURITY.md). For SSO / RBAC / audit trails / encryption at rest, the OSS install stops at the LAN-share tier. Those are a separate enterprise build (`hello@lyriks.io`).

## Architecture

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

## Status

Early but functional. Used internally to model products, generate typed scaffolding, audit implementation against spec, run multi-agent editing sessions, and recursively refine the runtime itself.

## Why open source?

Built internally because existing AI workflows were becoming increasingly hard to reason about as systems grew. The runtime became useful enough that we released it as standalone OSS, separate from our formal coherence research and engine work.

## License

AGPL-3.0. You're free to use, study, modify, and self-host. Improvements and derivative networked versions stay open under the same license. See [LICENSE](LICENSE).
