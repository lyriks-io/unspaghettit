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

Unspaghettit replaces the guessing with a runtime: a structured, executable model of what your product is supposed to do, that humans and AI agents read and edit through MCP. Every scenario you write runs through a deterministic simulator and reports pass or fail, **before a line of code exists**.

Prompts become disposable. The specification stays.

## See it work

You, in your AI agent (Claude Code, Cursor, Gemini, Windsurf, Codex):

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

## The problem it kills

AI coding workflows go sideways fast. Specs drift. Prompts pile up. Generated systems lose coherence as they grow. Most tools answer this with markdown specs: documents the AI reads to generate code.

A document can't tell you it contradicts itself. Markdown drifts in silence. You find out when the code breaks.

Unspaghettit takes the other path. Your spec isn't a document. It runs.

## What makes it different

Unspaghettit is a local, executable specification layer. It gives the LLM durable project memory that can be validated, simulated, scored, and mapped back to source code. That sets it apart from:

- **Markdown prompt workflows**, which are easy to write but cannot execute or report drift.
- **Autonomous agent frameworks**, which decide how work gets done but rarely model product behavior as a contract.
- **Hosted AI wrappers**, which add a service boundary instead of keeping the source of truth in your repo.
- **No-code platforms**, which own the implementation path.
- **Code generators**, because Unspaghettit produces contracts and audit data while your LLM or team writes the actual code.

It works in both directions. Start from an idea and drive spec → code, or point an LLM at an existing codebase and build a code → spec map that makes current behavior explicit.

## Quickstart

```bash
npm install -g unspaghettit
```

```bash
cd path/to/your-app
unspa init        # scaffold + register the MCP with your AI clients
unspa dashboard   # http://localhost:3000
```

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
