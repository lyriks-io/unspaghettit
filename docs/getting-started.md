# Getting started

## Install

```bash
npm install -g unspaghettit
```

Requires Node.js 20.10 or newer.

## Wire up a project

```bash
cd path/to/your-app
unspa init        # register the MCP with your AI clients + seed CLAUDE.md/AGENTS.md + install skills
unspa dashboard   # opens http://localhost:3000
```

`unspa init` registers the MCP server with the AI clients you select, then **restart your IDE** so the client picks up the new tools. Your LLM now has the runtime's full tool surface.

Re-running `unspa init` is safe. Every step is idempotent: existing entries are preserved, managed blocks refresh in place.

You normally don't run the MCP server by hand - your AI client spawns `unspa-mcp` on demand. `unspa serve` exists as a debugging hatch if you ever need to test the stdio interface yourself.

## Supported clients

`unspa init` registers the MCP server with the clients you pick. Supported out of the box:

| Client | Project config | Global config |
| --- | --- | --- |
| Claude Code (CLI + VSC) | `.mcp.json` | `~/.claude.json` |
| Claude Desktop | n/a (no project scope) | `%APPDATA%\Claude\claude_desktop_config.json` (Windows) / `~/Library/Application Support/Claude/...` (macOS) |
| Cursor | `.cursor/mcp.json` | `~/.cursor/mcp.json` |
| Gemini Code Assist / CLI | `.gemini/settings.json` | `~/.gemini/settings.json` |
| Windsurf | n/a | `~/.codeium/windsurf/mcp_config.json` |
| Kiro | `.kiro/settings/mcp.json` | `~/.kiro/settings/mcp.json` |
| Codex (VS Code) | prints snippet to paste manually | same |

For any client without an automated config write (Codex and friends), `unspa init` prints the MCP JSON snippet to copy into the client's MCP settings.

## Explore the dashboard

Boot `unspa dashboard`, then:

- Click **Load samples** to install the bundled **eShop** project: four LLM-sized features (Account & auth, Catalog & reviews, Cart & checkout, Order fulfillment) that exercise the full capability surface - composite and Expression conditions, feature invariants, event cascades, `bypassInvariants`, action invariants, scenarios, persona overrides, and entity/resource mapping. Every feature scores 100% maturity, so it works as a clean reference model.
- To see maturity gaps in action, create a tiny scratch feature with an empty surface or an action without effects or scenarios. The dashboard shows the missing pieces.
- Open the **Tutorial** page (`/tutorial`) for a 14-section walkthrough, and hit **Run interactive tutorial** for a guided spotlight tour from project to feature to surface to action to parameter to rule to simulator, prefilling fields and gating each step on the right thing being typed or clicked.

## Where the model lives (shared hub by default)

`unspa init` needs no decision about storage. The behavior model lives in a **shared hub** at `~/.unspa-hub/unspa`, and both the MCP server and `unspa dashboard` discover it automatically on first run - no `UNSPA_SNAPSHOTS`, no special launch directory. One source of truth across every repo and every client (including clients with no per-project scope), and one `unspa dashboard` run from anywhere serves it.

Want the model versioned **inside a specific repo** instead - travelling in git and PRs? Opt into a per-repo install:

```bash
unspa init --local            # scaffold this repo's unspa/ folder (found by walk-up)
unspa init --custom           # interactive: hub vs per-repo vs custom path
unspa init --hub /custom/path # a non-default hub location (pins UNSPA_SNAPSHOTS)
```

Discovery order, used by both the MCP and the dashboard: explicit `UNSPA_SNAPSHOTS` / `--snapshots` → a per-repo `unspa/` found by walking up from the launch directory → the shared hub. A per-repo `unspa/` always wins when present; everything else falls back to the hub.

Switching later is just a re-run: `unspa init` for the hub, `unspa init --local` for per-repo, or `unspa dashboard --snapshots <path>` for a one-off look at any folder. All loopback / single-machine; the hub is not a network service.

A typical end state: a global-scope MCP client for cross-project querying, per-repo agent instances pointed at the same hub (each bound to one project with `unspa link`), and one live dashboard reflecting every change.

## Two views over the model

The dashboard ships two views over the same model:

- **Expert** (default) - the full control surface: projects, features, surfaces, actions, the simulator, maturity, and implementation coverage.
- **Builder** (opt-in) - a simpler, guided view: browse projects → core features → features with Maturity / Built dials, accept AI-proposed improvements, and fill a per-project build queue where each item carries its own maturity / implementation goal.

```bash
unspa init --with builder        # at setup (or just answer the init prompt)
unspa view add builder           # anytime; persists for every `unspa dashboard`
unspa dashboard --view builder   # one-off, no persistence
unspa view remove builder        # turn it back off
unspa view list                  # show which views are enabled
```

With one view enabled the header shows no switcher; enabling Builder adds an **Expert | Builder** toggle. Enabled views are persisted next to the model (`<snapshots>/views.json`).

## Developing on the CLI itself

Clone the repo, then:

```bash
npm install && npm run build && npm link
```

See [cli/README.md](../cli/README.md) for commands, flags, and troubleshooting.
