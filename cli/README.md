# Unspaghettit CLI

A single command (`unspa`, also installed as `unspaghettit`) that bootstraps an Unspaghettit project in any repo,
runs the bundled MCP server, and boots the dashboard.

## Install

Zero-setup bootstrap (checks/installs Node, installs the CLI, registers the MCP globally with detected clients):

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/lyriks-io/unspaghettit/main/install.sh | sh
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/lyriks-io/unspaghettit/main/install.ps1 | iex
```

Or, if you already have Node.js 20.10+:

```bash
npm install -g unspaghettit
```

This installs the `unspa` (and `unspaghettit`) command globally. The tarball already includes the dashboard production build, so no `npm run build` step is needed.

Verify:

```bash
unspa --help
```

To remove later: see [Uninstall](#uninstall).

### Note on Windows

`npm install -g unspaghettit` installs three shims for each bin: the
extensionless POSIX form (e.g. `unspa`) plus `.cmd` and `.ps1` siblings.
PowerShell and CMD resolve all three; `unspa init` automatically wraps
the MCP entry with `cmd /c` so AI clients that `spawn()` without a shell
can find the `.cmd` shim. No extra setup
needed: just install and `unspa init`.

### Developing on the CLI itself

If you're contributing to Unspaghettit (not just using it), install from a clone via `npm link`:

```bash
git clone https://github.com/lyriks-io/unspaghettit.git
cd unspaghettit
npm install
npm run build       # builds the SvelteKit dashboard
npm link            # exposes `unspa` and `unspaghettit` globally pointing at this clone
```

After source changes, re-run `npm run build` so `unspa dashboard` picks them up. The CLI itself runs through `tsx` at invocation time, so CLI changes don't need a rebuild.

## Uninstall

Two paths, depending on how much you want cleaned up.

**Per-project cleanup + remove the global command** (recommended):

```bash
cd path/to/your-app          # any project where you ran `unspa init`
unspa uninstall --global-uninstall
```

This reverses everything `unspa init` did in the current project (strips the MCP server entry from every registered AI client, removes the managed blocks from `.gitignore` / `CLAUDE.md` / `AGENTS.md`, uninstalls the bundled skills, drops the repo→project link) and then runs `npm uninstall -g unspaghettit` to remove the global command. It also sweeps any leftover `unspa`, `unspa-mcp`, or `unspaghettit` shims (`.cmd` / `.ps1` / POSIX) from npm's global prefix, so an interrupted or `npm link`'d install can't leave the command on your PATH after the uninstall claims success. Pass `--purge` to also delete the project's `unspa/` folder (your feature JSONs). Pass `-y` to skip the confirms.

**Just remove the global command** (leaves per-project config behind):

```bash
npm uninstall -g unspaghettit
```

### Then deleting the cloned repo

Order matters: run the uninstall **before** deleting the cloned Unspaghettit folder. If you installed via `npm link`, the global shim is a symlink that points into the clone; deleting the clone while the symlink still exists leaves a dangling shim that fails noisily until you also uninstall. After uninstalling, the folder is safe to delete.

Verify:

```bash
unspa --help                 # should error: command not found
npm ls -g --depth=0          # should not list unspaghettit
```

If `unspa` still resolves after `npm uninstall -g unspaghettit`, you hit the orphan-shim case. npm left bin shims behind in its prefix. Either re-run `unspa uninstall --global-uninstall` (which runs the sweep) or manually delete the `unspa*` files at `$(npm prefix -g)/unspa*`.

### Multiple projects

`unspa uninstall` only cleans the project it's run in. If you ran `unspa init` in several repos on this machine, every one of them has an MCP server entry pointing at the (now-deleted) CLI. The AI clients will log "MCP server failed to start" until those entries are cleaned. Either run `unspa uninstall` inside each project *before* removing the clone, or hand-edit the MCP config files listed in the [AI client support](#ai-client-support) table.

## Command surface

Setup, run, verify, and codegen.

| Command                       | What it does                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| `unspa init`                  | Scaffold `unspa/`, register the MCP with picked AI clients (entry targets `unspa-mcp`), seed `CLAUDE.md`/`AGENTS.md`, install skills. Idempotent. |
| `unspa serve`                 | Run the bundled MCP server on stdio (kept for manual debugging; init's entry uses `unspa-mcp` directly). |
| `unspa dashboard`             | Boot the SvelteKit dashboard from the `unspa/` folder discovered by walking up from cwd. `--view <ids>` enables opt-in views for the run. |
| `unspa check`                 | **CI gate.** Run the verification spine headlessly (scenarios + maturity + reachability + optional model checking + spec→code drift + cross-feature event coherence) and **exit non-zero on failure**. `--json` for CI dashboards. |
| `unspa ci`                    | Scaffold a GitHub Actions workflow (`.github/workflows/unspaghettit.yml`) that runs `unspa check` on every push / PR. |
| `unspa coverage ingest`       | **[experimental]** Read a Vitest JSON report of the generated scenario spec and mark actions whose scenarios passed as **verified** in `.unspa.json` (proven against the spec). Gate with `unspa check --min-verified`. |
| `unspa view`                  | Manage opt-in dashboard views (Expert is always on): `view list`, `view add <id>` (e.g. `builder`), `view remove <id>`. Persists in `<snapshots>/views.json`. |
| `unspa list`                  | List the projects in the local `unspa/` folder. `--json` prints a scriptable payload. |
| `unspa link`                  | Bind this repo to one project via `.unspa.json` so the MCP scopes its queries to that project. `--unlink` removes the binding. |
| `unspa adopt`                 | **Code → spec on-ramp.** Print the paste-ready agent prompt that models an existing codebase through the MCP with full provenance (code sources + spans), then seeds `.unspa.json` coverage from the spans (`seed_index_from_analysis`). `--prompt-only` for piping. |
| `unspa scenarios export`      | **[experimental]** Generate a Vitest spec from a feature's authored scenarios, using the deterministic simulator as the oracle. |
| `unspa scenarios adapter`     | **[experimental]** Scaffold the `UnspaAdapter` stub the export needs - a case per scenario-bearing action, pre-seeded with `.unspa.json` implementation locations. |
| `unspa uninstall`             | Reverse `init`: strip the MCP entry from picked clients, remove the unspa blocks from `.gitignore` / `CLAUDE.md` / `AGENTS.md`, uninstall skills, optionally purge `unspa/` and unlink the CLI globally. |

## Quick start (in any repo)

```bash
cd path/to/your-app
unspa init           # interactive: scaffold + register MCP + context + skills
unspa dashboard      # open the dashboard at http://localhost:3000
```

That's it. Your AI client spawns
`unspa-mcp` on demand via the entry written to its MCP config, reads
the Unspaghettit instructions from `CLAUDE.md` / `AGENTS.md`, and can invoke
the bundled `/unspa-edit`, `/unspa-implement`, `/unspa-audit` skills.

If you are new to MCP and already have an AI agent open in the repo, you can
also ask it to perform the setup:

```text
Install Unspaghettit in this repo. Run unspa init, register the MCP server for my client, keep the generated CLAUDE.md/AGENTS.md guidance, then verify the unspa MCP tools are available.
```

After setup, restart the AI client if its MCP server list does not refresh
automatically.

## Commands

### `unspa init`

Bootstraps an Unspaghettit project in the current repo. Every step is idempotent ,
re-running updates managed blocks in place, never duplicates.

```bash
unspa init                              # default: shared hub, GLOBAL MCP registration, picks clients interactively
unspa init --yes                        # non-interactive; wires only the clients detected on this machine
unspa init --clients claude-code,cursor # only register specific clients
unspa init --scope project              # write a per-repo entry (.mcp.json etc.) instead of the global user config
unspa init --local                      # per-repo install: scaffold this repo's unspa/ folder
unspa init --custom                     # interactive picker: hub vs per-repo vs custom path
unspa init --hub /custom/path           # a non-default hub location (pins UNSPA_SNAPSHOTS)
unspa init --no-gitignore --no-context --no-skills  # opt out of optional steps
unspa init --fun                        # pre-check the opt-in narrative skills (also: invoke as `unspaghettit init`)
```

What it does:

1. **Resolves where the model lives.** By default this is the **shared hub** (`~/.unspa-hub/unspa`) - no folder is scaffolded in the repo and no `UNSPA_SNAPSHOTS` is written, because discovery falls back to the hub automatically. Pass `--local` to scaffold a per-repo `unspa/` (found by walk-up, so the model travels with the repo in git), or `--hub <path>` for a non-default hub location.
2. **Registers the MCP server** with the AI clients you pick, **globally by
   default**: it writes each client's user-level config (`~/.claude.json`,
   `~/.cursor/mcp.json`, `~/.codex/config.toml`, …), so the MCP attaches in
   every repo after one install, including clients with no per-project scope.
   Pass `--scope project` to write a per-repo entry (`.mcp.json`,
   `.cursor/mcp.json`, …) that travels with the repo in git instead. The entry
   targets `unspa-mcp` (the dedicated MCP bin, faster startup than going through
   `unspa serve`):
   - macOS / Linux: `{ "type": "stdio", "command": "unspa-mcp", "args": [] }`
   - Windows: `{ "type": "stdio", "command": "cmd", "args": ["/c", "unspa-mcp"] }`
     because AI clients spawn without a shell, and Node refuses to execute
     `.cmd` / `.ps1` shims directly, so we wrap with `cmd /c`.

   For the default hub and per-repo (`--local`) installs the entry carries **no env** - discovery finds the folder. Only `--hub <path>` (a non-default location) adds `env.UNSPA_SNAPSHOTS=<absolute path>`, since walk-up can't reach it.

   Merged into existing entries, your other servers stay intact: a `mcpServers.*`
   JSON block for every client, or a `[mcp_servers.unspa]` TOML table for Codex.
3. **Adds a `# >>> unspa` block to `.gitignore`** for hot-reload artefacts.
4. **Inserts a `<!-- >>> unspa -->` block into `CLAUDE.md` and `AGENTS.md`**
   so any AI assistant working in the repo learns:
   - That an Unspaghettit MCP server is available
   - When to use it instead of regenerating JSON
   - How to record implementations in the `.unspa.json` behavioral index
5. **Installs the three core skills under `.claude/skills/`** (see [Skills](#skills)). Two opt-in narrative skills (`unspa-worldbuild`, `unspa-worldplay`) also ship with the package and land when fun mode is on - invoke the CLI as `unspaghettit init`, pass `--fun`, or tick the box in the interactive prompt.

#### Where the model lives

Discovery order, shared by the MCP server and `unspa dashboard`:

1. Explicit override - `UNSPA_SNAPSHOTS` env var, the MCP's `--snapshots` flag, or `unspa dashboard --snapshots <dir>`.
2. A per-repo `unspa/` folder found by **walking up** from the launch directory.
3. The **shared hub** at `~/.unspa-hub/unspa` (the default fallback).

So the **default install needs zero configuration**: nothing is scaffolded, no env var is written, and both the MCP and the dashboard land on the hub the first time. One source of truth across every repo and client, including clients with no per-project MCP config and no useful launch cwd, which now find the hub without any absolute path baked in.

Pick a different location explicitly:

```bash
unspa init --local                   # per-repo unspa/ folder, found by walk-up (model lives in git)
unspa init --hub ~/work/unspa-hub    # non-default hub (~/ expands; pins UNSPA_SNAPSHOTS)
unspa init --hub /abs/path/to/hub    # absolute non-default hub path
unspa init --custom                  # interactive: choose hub / per-repo / custom path
```

- A **per-repo `unspa/`** (`--local`) writes no env var - the model travels with the repo and wins via walk-up whenever a client launches inside it.
- A **non-default hub path** (`--hub <path>`) does write `env.UNSPA_SNAPSHOTS=<resolved path>`, because walk-up can't reach it.
- Repo-level binding still works in any mode: run `unspa link` inside a repo to write `.unspa.json` and scope that repo's MCP queries to one project.
- Switch later with a re-run (`unspa init`, `unspa init --local`, `unspa init --hub <path>`), or take a one-off look at any folder with `unspa dashboard --snapshots <dir>`.

The hub is loopback / single-machine. For cross-machine sharing use the LAN-share tier of `unspa dashboard` instead.

### `unspa serve`

Runs the bundled MCP server on stdio by spawning the `unspa-mcp` bin
through `tsx`. Kept for manual debugging. The entry that `unspa init`
writes targets `unspa-mcp` directly (faster startup, no subprocess hop).
**You normally don't run this manually.**

```bash
unspa serve                          # auto-discovers unspa/ walking up from cwd
unspa serve --snapshots ./elsewhere  # override the folder
```

### `unspa dashboard`

Boots the SvelteKit dashboard pointing at this repo's `unspa/` folder.

```bash
unspa dashboard               # default port 3000
unspa dashboard --port 4000
unspa dashboard --host 127.0.0.1
unspa dashboard --view builder  # enable opt-in views for this run (see `unspa view`)
```

Requires `npm run build` to have been run once in the Unspaghettit repo (this
generates the `build/` folder the CLI ships).

**Default**: binds `127.0.0.1` (loopback only) with no auth. Single-machine
trust boundary. Appropriate for solo dev.

**LAN-share tier**: to make the dashboard reachable on a trusted network,
set the auth env vars before launching:

```bash
# Generate a strong shared token (any random string works):
export UNSPA_AUTH_TOKEN=$(node -e "console.log(crypto.randomBytes(24).toString('base64url'))")

# Optional but recommended: close cross-site browser CSRF:
export UNSPA_ALLOWED_ORIGIN=http://<your-host>:3000

# Then bind on the LAN interface:
unspa dashboard --host 0.0.0.0
```

When `UNSPA_AUTH_TOKEN` is set, every REST + WebSocket request must carry
the token. The startup banner shows the configured posture
(`Security: auth=TOKEN origin=...`). **Set the same `UNSPA_AUTH_TOKEN` in
the MCP server's env** (`.mcp.json#env`) so `notifySyncReload` calls from
the MCP authenticate too.

Don't expose `0.0.0.0:3000` to the public internet. The OSS install is
built for trusted networks; for SSO / RBAC / audit trails / encryption at
rest you've outgrown the OSS tier. See `SECURITY.md` for the threat model
and the enterprise pointer.

### `unspa view`

Manage which dashboard views are enabled. **Expert** is the always-on default;
**Builder** (and future views) are opt-in. Enablement persists in
`<snapshots>/views.json`, so it survives across `unspa dashboard` runs. The
header only shows a view switcher when more than one view is on.

```bash
unspa view list             # show opt-in views and whether each is enabled
unspa view add builder      # enable the Builder view (persists)
unspa view remove builder   # disable it again
```

You can also enable a view at setup with `unspa init --with builder` (or answer
the init prompt), or for a single run with `unspa dashboard --view builder`.

### `unspa check [featureId]`

Runs the whole verification spine over a project and **exits non-zero on failure**, so the spec can break a build instead of staying advisory. Per feature it runs every scenario as an executable spec test, scores maturity, analyses surface (navigation) reachability, optionally model-checks the reachable state space, and folds in spec→code drift and cross-feature event coherence. Each check is `pass` / `warn` / `fail`; the run fails only on genuine failures (a failing scenario, a reachable invariant violation, or - when explicitly gated - the others).

```bash
unspa check                          # verify the repo's linked project (or all features)
unspa check <featureId>              # verify one feature
unspa check --project <id>           # verify a specific project's features
unspa check --model-check            # also run bounded model checking (counterexamples, liveness)
unspa check --json                   # full report as JSON (for CI dashboards)
```

Gating flags (default: warn, not fail):

```bash
unspa check --min-maturity 80        # fail features below 80% maturity
unspa check --min-verified 80        # fail features <80% of actions proven against code (see `coverage ingest`)
unspa check --require-scenarios      # fail features with no scenarios
unspa check --fail-on-drift          # fail when code was audited against an older spec
unspa check --fail-on-unmet-goals    # fail when a reachability/liveness goal is unmet (needs --model-check)
unspa check --fail-on-dead-actions   # fail when an action never fires within the model-check bound
unspa check --allow-invariant-violations   # downgrade reachable invariant violations to warnings
```

Exit codes: `0` pass, `1` verification failed, `2` no snapshots / bad feature id. In CI, drop it after install: `unspa check --model-check --min-maturity 80`. The MCP exposes the same thing in-chat as `verify`, and drift alone as `get_drift`.

### `unspa scenarios export <featureId>` (experimental)

Generates a Vitest spec from a feature's authored scenarios. The deterministic
simulator runs each scenario at codegen time and embeds its predicted outcome
(success/blocked + the scenario's `expectedAssertions`) as the test oracle.
You then write a thin adapter that calls your real implementation; the
generated test drives each scenario through that adapter and asserts state
path-by-path.

```bash
unspa scenarios export <featureId>                     # ./<feature-slug>.scenarios.spec.ts
unspa scenarios export <featureId> --out tests/foo.spec.ts
unspa scenarios export <featureId> --adapter ../src/unspa.adapter
unspa scenarios export <featureId> --dry-run           # print to stdout, don't write
unspa scenarios export <featureId> --force             # overwrite existing file
```

Find feature ids via `unspa list` (then open a project) or the dashboard.

**Write the adapter once per project** at the path the generator hints at
(default `./unspa.adapter.ts`):

```ts
import type { UnspaAdapter } from 'unspaghettit/cli/scenarios';

export const adapter: UnspaAdapter = {
  invoke: async (input) => {
    // input.actionId / input.parameters / input.initialState tell you which
    // scenario is running. Call your real code, return:
    return { status: 'success', finalState: { /* dotted-path state */ } };
    // or { status: 'blocked', finalState: input.initialState } when a guard
    // rejected the call. The generator emits exactly one shape per scenario.
  }
};
```

Then `npx vitest run` against the generated file.

**Drift reporting**: if the simulator's prediction disagrees with a scenario's
authored `expectedStatus`, the CLI prints the disagreement and the generated
test embeds a comment showing both. Tests still emit as authored - the human
picks which oracle is right.

**Status: preview.** The adapter contract (`UnspaAdapter`, `AdapterInvocation`,
`AdapterResult`) may change between minor versions until the wedge graduates.
Pin the `unspaghettit` dependency if CI depends on these tests.

### `unspa scenarios adapter <featureId>` (experimental)

Scaffolds the adapter that `scenarios export` calls, so you don't write it from
scratch. It emits one `case` per scenario-bearing action (exactly the actions the
export tests cover), pre-seeded with the implementation location recorded in
`.unspa.json` (`file:line - signature`) as a comment, plus a `TODO` body.

```bash
unspa scenarios adapter <featureId>            # writes ./unspa.adapter.ts
unspa scenarios adapter <featureId> --dry-run  # print to stdout
unspa scenarios adapter <featureId> --out tests/unspa.adapter.ts
unspa scenarios adapter <featureId> --force    # overwrite an existing file
```

Loop: `scenarios adapter` → fill the TODOs with calls into your real code →
`scenarios export` → `vitest`. A scenario that disagrees with the implementation
then fails CI. Same experimental status as `export`.

### `unspa coverage ingest <resultsFile>` (experimental)

Closes the proof loop: turns a real `vitest` run into **verified** coverage in
`.unspa.json`. The generated spec tags each test with a token
(`[unspa:surface:action:scenario]`), so a standard Vitest JSON report maps back
to the spec - no custom reporter needed.

```bash
# 1. generate the spec + adapter, fill the adapter, then run vitest with the JSON reporter:
vitest run my-feature.scenarios.spec.ts --reporter=json --outputFile=unspa-results.json
# 2. ingest the report - stamps verifiedAt on each action whose scenarios all passed:
unspa coverage ingest unspa-results.json
unspa coverage ingest unspa-results.json --dry-run   # preview, don't write
```

An action whose scenarios all pass is stamped `verifiedAt` (promoted from
"claimed implemented" to "proven"); one that regresses has the stamp cleared.
Recording only - gate on it with `unspa check --min-verified <pct>`. The
adapter/report contract is preview, same as `scenarios export`.

## Skills

`unspa init` installs Claude-format skills under `<cwd>/.claude/skills/`.
Each is a self-contained `SKILL.md` that an MCP-aware AI client invokes
when its description matches the user's task. Four skills are core and
install by default; two are opt-in and only land when fun mode is on
(invoke as `unspaghettit init`, pass `--fun`, or tick the box).

| Skill                | Default | Triggers when                                              |
| -------------------- | :-----: | ---------------------------------------------------------- |
| `unspa-edit`         | ✓       | User wants to edit the model (add/change action, etc.)     |
| `unspa-implement`    | ✓       | User is writing code that backs an Unspaghettit entity     |
| `unspa-audit`        | ✓       | User asks "what's implemented" / "what's missing"          |
| `unspa-adopt`        | ✓       | User wants an existing codebase turned into a model (code → spec, with provenance + seeded coverage) |
| `unspa-worldbuild`   | opt-in  | Modeling a fictional/interactive world (text adventure, RPG quest, narrative environment) |
| `unspa-worldplay`    | opt-in  | Walking a player through a world built with `unspa-worldbuild` |

The core skills tell the AI to: use the MCP tools instead of regenerating
JSON, record implementations in the `.unspa.json` behavioral index rather
than annotating source code, and call `sync_from_index` so the dashboard
sees new coverage. The narrative pair maps locations to surfaces, world
state to shared state, and "what the player can do here" to actions with
preconditions - see the closing section of the project README for the
full pitch. Skills live in the project so they version with the codebase.

## AI client support

`unspa init` registers the MCP server with these clients. **Global scope is the
default** (one install, attached in every repo); `--scope project` writes the
per-repo entry instead.

| Client                   | Global scope (default)                          | Project scope (`--scope project`) |
| ------------------------ | ----------------------------------------------- | --------------------------------- |
| Claude Code (CLI + VSC)  | `~/.claude.json`                                | `.mcp.json`                       |
| Claude Desktop           | `%APPDATA%\Claude\claude_desktop_config.json` (Windows) / `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) | n/a *(no per-project config)* |
| Cursor                   | `~/.cursor/mcp.json`                            | `.cursor/mcp.json`                |
| Gemini Code Assist / CLI | `~/.gemini/settings.json`                       | `.gemini/settings.json`           |
| Windsurf                 | `~/.codeium/windsurf/mcp_config.json`           | n/a                               |
| Kiro                     | `~/.kiro/settings/mcp.json`                     | `.kiro/settings/mcp.json`         |
| Codex (CLI + VS Code)    | `~/.codex/config.toml`                          | `.codex/config.toml` *(trusted projects only)* |

The Codex CLI and VS Code extension share `~/.codex/config.toml`, so one write
covers both. All writes are **merging**: your existing `mcpServers.*` JSON
entries (and, for Codex, other `[mcp_servers.*]` TOML tables) are preserved.
`unspa init --yes` and the bootstrap scripts only touch clients already present
on the machine, so no config folders are created for tools you don't use.

## Context files (`CLAUDE.md` / `AGENTS.md`)

`unspa init` inserts a managed block into both files:

```markdown
<!-- >>> unspa -->
## Unspaghettit (auto-managed by `unspa` CLI)
...
<!-- <<< unspa -->
```

The block tells AI assistants in this repo what Unspaghettit is, where the
model lives, that an MCP server is available, the preferred tool
workflow, how to record implementations in `.unspa.json`, and what NOT to
do.

`CLAUDE.md` is read by Claude Code; `AGENTS.md` is the emerging
cross-tool standard read by Codex, Cursor, Windsurf, Gemini, and others.
Writing both means most assistants pick up the Unspaghettit instructions
automatically.

The block is bracketed by HTML comments so the rest of the file is yours
to edit. Re-running `init` refreshes only what's between the markers.

## How the pieces fit

```
your-app/
├── unspa/                           ← feature JSONs (source of truth)
├── .claude/
│   └── skills/
│       ├── unspa-edit/SKILL.md      ← installed by `unspa init`
│       ├── unspa-implement/SKILL.md
│       ├── unspa-audit/SKILL.md
│       ├── unspa-worldbuild/SKILL.md  ← opt-in (fun mode)
│       └── unspa-worldplay/SKILL.md   ← opt-in (fun mode)
├── .mcp.json                        ← MCP registration (Claude Code)
├── .cursor/mcp.json                 ← MCP registration (Cursor) (optional)
├── .gemini/settings.json            ← MCP registration (Gemini) (optional)
├── .kiro/settings/mcp.json          ← MCP registration (Kiro) (optional)
├── CLAUDE.md                        ← managed unspa block + your content
├── AGENTS.md                        ← managed unspa block + your content
├── .gitignore                       ← managed unspa block
├── .unspa.json                      ← behavioral index (code↔spec mapping)
└── src/
    └── ...                          ← your code (no tags; index does the mapping)
```

## Troubleshooting

**`unspa: command not found`**. The global shim isn't on the shell's
PATH. Three things to check, in order:

1. Did `npm link` create the shim? From the cloned Unspaghettit repo:
   `npm ls -g --depth=0` should list `unspaghettit -> <your clone path>`.
   If not, re-run `npm link` from the repo root (no arguments; `npm link <pkg>`
   does the opposite, it consumes the link inside another project).
2. Is npm's global bin on your user PATH? Run `npm prefix -g` to find it
   (e.g. `C:\Users\<you>\AppData\Roaming\npm` on Windows, `/usr/local/bin`
   or `~/.npm-global/bin` elsewhere). That directory must be on your
   persistent user PATH.
3. Is the shell session inheriting the current PATH? On Windows, VS Code
   captures its env at launch, so a window opened before the PATH change
   keeps the old env. **Fully quit** VS Code (File → Exit; kill stragglers
   in Task Manager if needed) and reopen. New shells will see the
   updated PATH.

**`unspa` resolves but every invocation errors out** (development install
only). The global symlink npm created points at a path that no longer
exists. This usually happens because the cloned Unspaghettit folder was renamed or
moved after `npm link`. Re-running `npm link` from the new location does
**not** overwrite the existing global entry. Clear it first, then re-link:

```bash
npm unlink -g unspaghettit
cd path/to/Unspaghettit            # the current location of the clone
npm link
npm ls -g unspaghettit --depth=0   # verify the arrow points at the current path
```

This only affects `npm link` installs. Once the package is published to
npm and users install via `npm install -g unspaghettit`, the files are
copied into npm's global tree and no symlink is involved.

**`Dashboard build missing`**. Run `npm run build` in the Unspaghettit repo
once. The CLI re-uses the resulting `build/` folder.

**Claude Desktop on macOS shows no Unspaghettit tools** (`spawn unspa-mcp
ENOENT` in `~/Library/Logs/Claude/mcp-server-unspa.log`). GUI apps on macOS
launch with a **minimal PATH** (`/usr/bin:/bin:/usr/sbin:/sbin`) that excludes
the npm global bin and often node itself, so a bare `unspa-mcp` command can't be
found. `unspa init` handles this: on macOS / Linux it writes an **absolute**
node + script entry (`"command": "/path/to/node", "args":
["/path/to/mcp-server/bin.cjs"]`) that needs nothing on PATH. If you hit this,
re-run `unspa init` (0.6+) and restart Claude Desktop. Claude Code in a terminal
is unaffected (it inherits your shell PATH); Windows is unaffected (GUI apps
inherit the user PATH, and the entry routes through `cmd /c`). After a **node
version change** (e.g. via nvm), the pinned absolute path can go stale - re-run
`unspa init` to refresh it.

**MCP server never attaches** (AI client shows no Unspaghettit tools).
Affects users on **0.1.0 and 0.1.1** who installed via `npm install -g`.
The MCP entry written by those versions of `unspa init` spawns
`unspa serve`, which pointed tsx at a tsconfig that extends a SvelteKit-
generated file not in the npm tarball, so the child crashes during boot
before MCP can speak a byte and the AI client silently drops it.

Two fixes, in order of preference:

1. **Upgrade to 0.1.2+** and re-run `unspa init`. The init writer now
   emits an entry that runs the MCP bin directly (faster startup, no
   subprocess hop, dodges the bug). On Windows it wraps `unspa-mcp` in
   `cmd /c`; on macOS / Linux (0.6+) it pins an absolute node + script so
   minimal-PATH GUI hosts can spawn it. Both because AI clients `spawn()`
   without a shell.
2. **Hand-edit your `.mcp.json`** (or equivalent) to an equivalent shape:
   - macOS / Linux (absolute paths; find node with `which node`, and the
     script at `$(npm root -g)/unspaghettit/mcp-server/bin.cjs`):
     ```json
     { "mcpServers": { "unspa": { "type": "stdio", "command": "/usr/local/bin/node", "args": ["/usr/local/lib/node_modules/unspaghettit/mcp-server/bin.cjs"] } } }
     ```
     A bare `"command": "unspa-mcp"` also works for Claude Code in a terminal
     (it has your shell PATH), but not for a minimal-PATH GUI like Claude Desktop.
   - Windows:
     ```json
     { "mcpServers": { "unspa": { "type": "stdio", "command": "cmd", "args": ["/c", "unspa-mcp"] } } }
     ```

If the MCP fails on **0.1.2+**, the most likely cause is a missing module
under `$features/*` or `$shared/*`. Path aliases are resolved by
`cli/_aliases.cjs` (loaded by both bin shims). Make sure the shim chain
isn't being bypassed by a custom `unspa-mcp` invocation.

**"Project not found" / "Feature not found" right after creating it.**
Affects **0.1.0 and 0.1.1**. The dashboard's create-button flow does
`PUT /api/projects/<id>` then immediately `goto('/projects/<id>')`; on
those versions the PUT only wrote to the Y.Doc in-memory cache and the
disk write was deferred ~400 ms via a debounce. The page that loaded
right after read from disk, found nothing, and rendered the 404 view.
Same race happened for features. Fixed in 0.1.2: `replaceSnapshotViaSync`
now awaits the atomic disk write before returning. Upgrade and re-create;
the previously-orphaned snapshot was likely persisted by the debounce
seconds later, so refreshing the projects index should still show it.
