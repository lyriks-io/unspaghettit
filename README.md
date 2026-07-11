<p align="center">
  <img src="https://raw.githubusercontent.com/lyriks-io/unspaghettit/main/static/unspaghettit_logo.png" alt="Unspaghettit" width="180" />
</p>

<h1 align="center">Unspaghettit</h1>

<p align="center"><em>Your specs shouldn't be markdown. They should pass or fail.</em></p>

<p align="center">
  <a href="https://github.com/lyriks-io/unspaghettit/actions/workflows/ci.yml"><img src="https://github.com/lyriks-io/unspaghettit/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.gnu.org/licenses/agpl-3.0.html"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL-3.0" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%E2%89%A520.10-43853d.svg" alt="Node >= 20.10" /></a>
  <a href="https://www.npmjs.com/package/unspaghettit"><img src="https://img.shields.io/npm/v/unspaghettit.svg" alt="npm" /></a>
</p>

<p align="center"><strong>Local-first</strong> &nbsp;·&nbsp; <strong>MCP-native</strong> &nbsp;·&nbsp; <strong>AGPL-3.0</strong></p>

<p align="center">
  <img src="https://raw.githubusercontent.com/lyriks-io/unspaghettit/main/static/unspaghettit-demo.gif" alt="Unspaghettit demo: prompt in your AI agent, the runtime builds, the simulator's red line" width="820" />
</p>

---

When you build with AI, the model never sees your system. It sees a fragment of context and guesses the rest from patterns. It doesn't understand. It infers.

Unspaghettit replaces the guessing with a runtime: a structured, executable model of what your product is supposed to do. Humans and AI agents read and edit it through MCP, and every scenario you write runs through a deterministic simulator and reports pass or fail, **before a line of code exists**.

Prompts become disposable. The specification stays.

## What it is and isn't

Unspaghettit is a local, executable specification layer: durable project memory the LLM can validate, simulate, score, and map back to source code. Concretely:

| It **is** | It **is not** |
| --- | --- |
| An executable specification runtime | A code generator |
| A typed MCP interface for humans and AI agents | A no-code / low-code platform |
| A deterministic simulator that passes or fails scenarios | An autonomous agent framework |
| Durable memory shared between you and the LLM, the source of truth for your behavior | A hosted service that owns your data |
| A two-way map between spec and code | A replacement for your stack (your team still writes the code) |

It runs *alongside* your AI coding tools: it defines and validates the contract they build against.

## The problem it kills

AI coding workflows go sideways fast. Specs drift. Prompts pile up. Generated systems lose coherence as they grow. Most tools answer this with markdown specs: documents the AI reads to generate code.

A document can't tell you it contradicts itself. Markdown drifts in silence. You find out when the code breaks.

Unspaghettit takes the other path. Your spec isn't a document. It runs.

## See it work

You, in your AI agent:

```
Using the Unspaghettit MCP, create a project for a daily-coupon app.
A user gets one coupon per day for a shop near them.
Make each feature reach 100% maturity.
```

Unspaghettit builds a structured runtime instead of a wall of prose:

```
features · surfaces · actions · state · rules · invariants · scenarios
```

Then runs every scenario through the simulator:

```
✓  user receives one coupon per day
✓  coupon expires at midnight
✗  second claim same day   →  blocked by invariant: DailyLimit
```

No code has been written yet. The spec already fails loudly exactly where it should. That red line is a contradiction caught at design time instead of in production.

And it keeps failing loudly after the code exists: every spec entity maps to its implementation, drift is detected when either side changes alone, and `unspa check` runs it all as a CI gate. The spec doesn't just describe the build. It can fail it.

## Start from anything

Point your AI agent at whatever you already have: a design screenshot, a product brief, a Jira backlog, an existing codebase. It reads that and builds the executable model through MCP. From there Unspaghettit runs both directions. Drive **spec → code**: design the behavior, watch it pass or fail, then implement against a spec that already holds together. Or go **code → spec**: run `unspa adopt` and the agent turns existing behavior into a runtime map where every extracted element is traced to the exact code span it came from, and the spec-to-code coverage index is seeded automatically from those spans.

## What you get

- **Scenarios as spec tests**: the deterministic simulator runs every scenario, whole multi-step flows included, and reports pass or fail per assertion.
- **Bounded model checking**: explores the reachable state space for the paths you *didn't* write scenarios for: invariant counterexamples with the action path that reaches them, dead actions, deadlocks, and liveness goals ("done stays reachable"), drawing action inputs from their domains (enum values, booleans, numeric bounds) so input-gated branches are explored too.
- **Model what actually happens**: typed action outcomes (declined, timed out, partial), external dependencies + `invoke_operation` calls with their timeout / retry / idempotency contract, event delivery guarantees (a `required` handler failure fails the emitter; `transactional` rolls it back), and scoped invariant relaxation for repair actions.
- **Maturity scoring**: per-area scores plus an honest confidence matrix (the weakest dimension is the headline, so a strong score can't hide a zero); `get_spec_gaps` also proves rule-set contradictions and flags external calls with no timeout.
- **Spec ↔ code audit**: every entity records where it lives in code; coverage, gaps, and drift are reported, and generated scenario tests can *prove* the implementation matches, not just claim it.
- **A CI gate**: `unspa check` runs the whole verification spine and exits non-zero on failure; `unspa ci` scaffolds the GitHub Actions workflow.
- **An evidence-first strict gate**: `unspa check --strict` turns drift, skipped actions, truncated exploration, dead actions, unmet goals, missing scenarios, and incomplete verified coverage into failures instead of advisory warnings.
- **Generated TypeScript contracts**: state, event, and parameter types your implementation imports, so the compiler catches divergence first.
- **Diagrams & provenance**: project the model as a statechart, sequence, ER, flowchart, or mindmap (export Mermaid, DOT, SVG/PNG), and trace every element back to the exact source span it was extracted from.
- **Source trust & completeness**: rank sources by authority, record two that contradict each other as a first-class conflict (resolved by authority, not reading order), and measure the share of each source's behavior that actually reached the model, so "what might we be missing?" has an answer.
- **A live dashboard**: editor, simulator, behavior graph, verify view with navigable counterexample traces, implementation coverage, global search (⌘K).
- **Multi-agent ready**: real-time sync for several humans and AI agents editing at once, with per-agent attribution.
- **Local-first**: plain JSON on your disk. No accounts, no telemetry, no hosted service.

## Quickstart

### One line (no setup)

Don't want to touch a terminal more than once? This checks for Node.js (installs it if missing), installs the CLI, and registers the MCP **globally** with every AI client on your machine (Claude Code, Claude Desktop, Cursor, Codex, ...):

**macOS / Linux**
```bash
curl -fsSL https://raw.githubusercontent.com/lyriks-io/unspaghettit/main/install.sh | sh
```

**Windows (PowerShell)**
```powershell
irm https://raw.githubusercontent.com/lyriks-io/unspaghettit/main/install.ps1 | iex
```

Then restart your AI client and run `unspa dashboard`.

### With npm

If you already have Node.js 20.10+:

```bash
npm install -g unspaghettit
unspa init        # registers the MCP globally with your detected AI clients
unspa dashboard   # http://localhost:3000
```

`unspa init` registers the MCP **globally by default**, so the tools attach in every repo after one install. Inside a project it also seeds `CLAUDE.md`/`AGENTS.md` and skills. Want the entry to live in the repo instead? `unspa init --scope project` (pairs with `--local`).

Restart your IDE. Your LLM now has the full runtime as typed MCP tools. Open the dashboard and click **Load samples** to explore a complete eShop project, or **Run interactive tutorial** for a guided tour.

Full setup, client config, and shared-hub mode: [docs/getting-started.md](docs/getting-started.md).

## Documentation

| | |
| --- | --- |
| [Getting started](docs/getting-started.md) | Install, `unspa init`, client setup, hub mode, dashboard |
| [Core concepts](docs/concepts.md) | The model, scenarios as tests, maturity, model checking, the audit index |
| [Working with AI](docs/prompting.md) | Prompt patterns for spec, query, edit, and implementation |
| [Collaboration](docs/collaboration.md) | Multi-agent editing, real-time sync, attribution, history |
| [Security](docs/security.md) | Trust tiers, LAN sharing, encrypted backup |
| [Architecture](docs/architecture.md) | Repo layout, how the pieces fit, project status |
| [Worlds & quests](docs/worldbuilding.md) | Modeling interactive fiction and narrative state (for the brave) |

## Status

Early but functional. Used internally at [Lyriks.io](https://lyriks.io) to model products, generate typed scaffolding, audit implementation against spec, run multi-agent editing sessions, and recursively refine the runtime itself. We released it because existing AI workflows became hard to reason about as systems grew, and this fixed it.

## License

AGPL-3.0. Free to use, study, modify, and self-host. Improvements and derivative networked versions stay open under the same license. For SSO, RBAC, audit trails, and encryption at rest, see the enterprise build (`hello@lyriks.io`).

---

<p align="center">If Unspaghettit resonates, a ⭐ helps other people find it. An open-source project by <a href="https://lyriks.io">Lyriks.io</a>.</p>
