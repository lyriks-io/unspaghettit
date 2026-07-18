import { createRequire } from 'node:module';
import { Command } from 'commander';
import { runAdoptCommand } from './commands/adopt';
import { runCheckCommand } from './commands/check';
import { runCiCommand } from './commands/ci';
import { runCoverageIngestCommand } from './commands/coverage-ingest';
import { runDashboardCommand } from './commands/dashboard';
import { runInitCommand } from './commands/init';
import { runLinkCommand } from './commands/link';
import { runListCommand } from './commands/list';
import { runScenariosAdapterCommand } from './commands/scenarios-adapter';
import { runScenariosExportCommand } from './commands/scenarios-export';
import { runOutdatedCommand } from './commands/outdated';
import { runServeCommand } from './commands/serve';
import { runThemeCommand } from './commands/theme';
import { runUninstallCommand } from './commands/uninstall';
import { runViewCommand } from './commands/view';
import { log } from './util/log';
import {
  formatUpdateNotice,
  readCachedUpdateStatus,
  resolveUpdateStatus
} from '../src/features/update-check/infrastructure/updateCheck';

/**
 * The package publishes two bin aliases for the same CLI: `unspa` (short)
 * and `unspaghettit` (long). Invoking by the long name flips on "fun
 * mode" — the init flow pre-checks the opt-in narrative skills
 * (worldbuild + worldplay). The unlock is hidden in plain sight in the
 * README's closing section; users who don't notice still get the same
 * skills via the interactive checkbox or the explicit `--fun` flag.
 *
 * Detection lives on `process.env.UNSPA_FUN_MODE`, set by the
 * `cli/unspaghettit.cjs` wrapper. We can't use `process.argv[1]`
 * because npm's Windows `.cmd` shim re-invokes node with our `.cjs`
 * file as argv[1] regardless of which alias the user typed — the
 * alias name is lost. An env var set in the wrapper survives.
 */
const FUN_MODE_BY_INVOCATION = process.env.UNSPA_FUN_MODE === '1';

// Single source of truth for the CLI version: read package.json at runtime so
// `unspa --version` cannot drift from the published package version.
const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

/**
 * Passive update notice. Prints a one-line "newer version available" hint to
 * stderr on exit, read synchronously from the cache so it adds zero latency,
 * and kicks a background refresh so the cache is warm next time (long-running
 * commands like `dashboard` let it finish; short ones just re-check later).
 * stderr keeps machine output (`--json`) and, were it ever reached, a stdio
 * stream uncorrupted. Skipped for `serve` (the MCP stdio channel — the agent
 * learns about updates via get_repo_context instead) and `outdated` (which
 * prints its own, richer result). Fully silenced by the env opt-out, which
 * makes the cache read return "unknown".
 */
const installUpdateNotice = (): void => {
  const command = process.argv[2];
  if (command === 'serve' || command === 'outdated') return;
  void resolveUpdateStatus({ current: pkg.version }).catch(() => {});
  process.on('exit', () => {
    const notice = formatUpdateNotice(readCachedUpdateStatus({ current: pkg.version }));
    if (notice) log.warn(notice);
  });
};
installUpdateNotice();

// v0.1 surface:
//   init       register MCP with picked clients + optional CLAUDE.md/AGENTS.md
//              + skills. Snapshots default to the shared hub; --custom/--local/
//              --hub <path> pick another location. Fully idempotent.
//   serve      run the bundled MCP server on stdio. Used by the entry
//              `init` writes into each client's config.
//   dashboard  boot the SvelteKit dashboard against the discovered snapshots
//              (shared hub by default; a per-repo unspa/ wins via walk-up).
//   list       enumerate the features in the discovered snapshots folder
//              (human table + interactive picker, or JSON for scripts).
//   link       bind this repo to one project via .unspa.json so the MCP
//              scopes queries to that project without asking.
//   uninstall  reverse what `init` did: strip MCP entries from clients,
//              remove the .gitignore/CLAUDE.md/AGENTS.md/skills blocks,
//              optionally purge unspa/ and unlink the CLI globally.

const program = new Command();

program
  .name('unspa')
  .description(
    'Unspaghettit CLI. Init a project, register the MCP server with your AI clients, run the MCP, boot the dashboard. Also installed as `unspaghettit` for the full name.'
  )
  .version(pkg.version);

program
  .command('init')
  .description('Register the MCP server with your AI clients (globally by default, so it attaches in every repo), seed CLAUDE.md/AGENTS.md, install bundled skills. The behavior model lives in the shared hub (~/.unspa-hub/unspa) - no config needed. Safe to re-run; use --scope project for a per-repo entry.')
  .option('--clients <ids>', 'Comma list of client ids (e.g. claude-code,cursor,gemini) or "all".')
  .option('--scope <scope>', 'Where to register the MCP: "global" (default) writes each client\'s user config (~/.claude.json, ~/.cursor/mcp.json, ~/.codex/config.toml, ...) so the tools attach in every repo after one install. "project" writes a per-repo config (e.g. .mcp.json) that travels with the repo in git; pairs with --local.', 'global')
  .option('--custom', 'Open the interactive custom-install wizard: choose the shared hub, a per-repo unspa/ folder, or a custom hub path.')
  .option('--local', 'Per-repo install: scaffold a local unspa/ folder found by walk-up, so the model travels with the repo in git (the pre-hub behavior). No UNSPA_SNAPSHOTS is written.')
  .option('--hub [path]', 'Pin a hub location. Bare --hub is the default hub (same as no flag). --hub <path> points at a custom folder and writes UNSPA_SNAPSHOTS=<resolved-path> into each MCP entry. Re-run anytime to repoint.')
  .option('--no-gitignore', 'Skip the .gitignore additions.')
  .option('--no-context', 'Skip the CLAUDE.md / AGENTS.md context block additions.')
  .option('--no-skills', 'Skip installing the bundled unspa skills under .claude/skills/.')
  .option('--fun', 'Pre-check the opt-in narrative skills (worldbuild + worldplay) in the skill picker. Also implicitly on when the CLI is invoked as `unspaghettit`.')
  .option('--with <views>', 'Comma list of opt-in dashboard views to enable (e.g. "builder"). Expert is always on. Without it, interactive init offers the Builder view.')
  .option('--theme <id>', 'Set the dashboard colour theme at install (e.g. "classic"). Cosmetic only; persists so `unspa dashboard` boots with it. Switchable later via `unspa theme set` or the in-app header switcher.')
  .option('-y, --yes', 'Accept defaults. Non-interactive (CI / scripts).')
  .action(async (opts) => {
    if (opts.scope !== 'project' && opts.scope !== 'global') {
      log.err(`--scope must be "project" or "global" (got "${String(opts.scope)}")`);
      process.exit(1);
    }
    const code = await runInitCommand({
      clients: opts.clients,
      scope: opts.scope,
      yes: opts.yes,
      skipGitignore: opts.gitignore === false,
      skipContext: opts.context === false,
      skipSkills: opts.skills === false,
      // Commander resolves `--hub` (no value) to `true` and `--hub <path>` to a
      // string; `undefined` means the flag was omitted entirely.
      hub: opts.hub,
      local: opts.local === true,
      custom: opts.custom === true,
      fun: opts.fun === true || FUN_MODE_BY_INVOCATION,
      withViews: opts.with,
      theme: opts.theme
    });
    process.exit(code);
  });

program
  .command('serve')
  .description('Run the bundled MCP server on stdio. Invoked by AI clients via the entry `init` writes into their MCP config.')
  .option('-s, --snapshots <dir>', 'Override the snapshots folder (defaults to walking up from CWD, then the shared hub ~/.unspa-hub/unspa).')
  .action(async (opts) => {
    const code = await runServeCommand({ snapshots: opts.snapshots });
    process.exit(code);
  });

program
  .command('dashboard')
  .description('Boot the bundled SvelteKit dashboard. Defaults to the shared hub (~/.unspa-hub/unspa); a per-repo unspa/ found by walking up from CWD wins when present. Starts on port 43171 (advances to the next free port if taken) and prints the URL it bound.')
  .option('-p, --port <port>', 'Port to bind (default: 43171; advances to the next free port if taken unless pinned here).', (v) => Number.parseInt(v, 10))
  .option('-h, --host <host>', 'Host to bind (default: 127.0.0.1). Pass 0.0.0.0 to expose on the LAN; the dashboard has no auth, so do this only on trusted networks.')
  .option('-s, --snapshots <dir>', 'Point the dashboard at a specific snapshots folder (sets UNSPA_SNAPSHOTS for this run). Handy for a one-off look at a custom hub or another repo.')
  .option('--view <ids>', 'Comma list of optional views to enable beyond Expert (e.g. "builder"). Expert is always on and is the default; with no extra views the header shows no switcher.')
  .option('--theme <id>', 'Colour theme to boot with (e.g. "classic"). Cosmetic only; overrides the persisted `unspa theme set` choice for this run. The in-app header switcher can still change it live.')
  .action(async (opts) => {
    const code = await runDashboardCommand({ port: opts.port, host: opts.host, snapshots: opts.snapshots, views: opts.view, theme: opts.theme });
    process.exit(code);
  });

program
  .command('list')
  .description('List the projects in the discovered snapshots folder (shared hub by default; a per-repo unspa/ wins via walk-up). Pass --json for a scriptable payload; interactive picker re-binds the repo link unless --no-interactive.')
  .option('--json', 'Print the catalog as JSON (implies --no-interactive).')
  .option('--no-interactive', 'Skip the interactive picker at the end.')
  .action(async (opts) => {
    const code = await runListCommand({
      json: opts.json === true,
      noInteractive: opts.interactive === false || opts.json === true
    });
    process.exit(code);
  });

program
  .command('check [featureId]')
  .description('Verify the spec headlessly and exit non-zero on failure (CI gate). Runs every scenario as an executable spec test, scores maturity, analyses surface reachability, optionally model-checks the reachable state space, and reports spec→code drift. Scopes to the repo\'s linked project by default; pass a featureId or --project to narrow.')
  .option('-s, --snapshots <dir>', 'Verify a specific snapshots folder (defaults to walk-up, then the shared hub).')
  .option('--project <id>', 'Verify a specific project\'s features (overrides the .unspa.json link).')
  .option('--model-check', 'Also run bounded model checking (exhaustive state-space exploration). Off by default; it is the costly part.')
  .option('--strict', 'Evidence-first gate: model check, 100% maturity and verified coverage, scenarios required, and drift/dead/unmet/skipped/truncated findings fail.')
  .option('--max-depth <n>', 'Model-check action-depth bound (default 6).', (v) => Number.parseInt(v, 10))
  .option('--max-states <n>', 'Model-check state cap (default 2000).', (v) => Number.parseInt(v, 10))
  .option('--min-maturity <n>', 'Fail any feature scoring below this maturity percentage.', (v) => Number.parseInt(v, 10))
  .option('--min-verified <n>', 'Fail any feature where fewer than N% of actions are proven against code (via `unspa coverage ingest`).', (v) => Number.parseInt(v, 10))
  .option('--max-scenario-failures <n>', 'Tolerate up to N failing scenarios before failing (default 0).', (v) => Number.parseInt(v, 10))
  .option('--require-scenarios', 'Fail a feature that has no scenarios authored.')
  .option('--fail-on-drift', 'Fail when an implementation was audited against an older spec (default: warn only).')
  .option('--fail-on-dead-actions', 'Fail when an action never fires within the model-check bound (default: warn only).')
  .option('--fail-on-unmet-goals', 'Fail when a reachability/liveness goal is unmet (default: warn only). Requires --model-check.')
  .option('--fail-on-skipped-actions', 'Fail when model checking cannot exercise actions with unsupplied required parameters. Requires --model-check.')
  .option('--fail-on-truncated-exploration', 'Fail when model checking reaches its depth or state bound. Requires --model-check.')
  .option('--allow-invariant-violations', 'Downgrade reachable invariant violations from failure to warning.')
  .option('--json', 'Emit the full verification report as JSON instead of the human view.')
  .action(async (featureId, opts) => {
    const code = await runCheckCommand({
      featureId,
      snapshots: opts.snapshots,
      project: opts.project,
      json: opts.json === true,
      modelCheck: opts.modelCheck === true,
      strict: opts.strict === true,
      maxDepth: opts.maxDepth,
      maxStates: opts.maxStates,
      minMaturity: opts.minMaturity,
      minVerified: opts.minVerified,
      maxScenarioFailures: opts.maxScenarioFailures,
      requireScenarios: opts.requireScenarios === true,
      failOnDrift: opts.failOnDrift === true,
      failOnDeadActions: opts.failOnDeadActions === true,
      failOnUnmetGoals: opts.failOnUnmetGoals === true,
      failOnSkippedActions: opts.failOnSkippedActions === true,
      failOnTruncatedExploration: opts.failOnTruncatedExploration === true,
      allowInvariantViolations: opts.allowInvariantViolations === true
    });
    process.exit(code);
  });

program
  .command('ci')
  .description('Scaffold a GitHub Actions workflow (.github/workflows/unspaghettit.yml) that runs `unspa check` on every push / PR, so the spec gates CI. Requires the model to travel with the repo (`unspa init --local`). Refuses to clobber without --force.')
  .option('-o, --out <path>', 'Output path (default: .github/workflows/unspaghettit.yml).')
  .option('--model-check', 'Run bounded model checking in the workflow (deeper: invariant + liveness counterexamples).')
  .option('--dry-run', 'Print the workflow to stdout instead of writing it.')
  .option('-f, --force', 'Overwrite an existing workflow file.')
  .action(async (opts) => {
    const code = await runCiCommand({
      out: opts.out,
      modelCheck: opts.modelCheck === true,
      dryRun: opts.dryRun === true,
      force: opts.force === true
    });
    process.exit(code);
  });

program
  .command('adopt')
  .description('Adopt an existing codebase into Unspaghettit (code -> spec): prints the paste-ready agent prompt that models the code through the MCP with full provenance, then seeds .unspa.json implementation coverage from the recorded code spans (seed_index_from_analysis). Pairs with the bundled unspa-adopt skill.')
  .option('--prompt-only', 'Print only the agent prompt (no status banner), for piping into a clipboard or file.')
  .action(async (opts) => {
    const code = await runAdoptCommand({ promptOnly: opts.promptOnly === true });
    process.exit(code);
  });

program
  .command('outdated')
  .description('Check npm for a newer unspaghettit release and print whether an update is available. Hits the registry live; --json prints the raw status for scripts. A passive one-line notice also appears after other commands (silence it with UNSPA_NO_UPDATE_CHECK=1).')
  .option('--json', 'Print the version status as JSON ({ current, latest, updateAvailable }).')
  .action(async (opts) => {
    process.exit(await runOutdatedCommand({ json: opts.json === true }));
  });

program
  .command('link')
  .description('Bind this repo to a single project via .unspa.json so the MCP scopes its queries to that project (and the LLM picks the right feature from the project\'s members for the task at hand). Pass --unlink to remove the binding.')
  .option('--project-id <id>', 'Direct id to link, skipping the interactive picker.')
  .option('--unlink', 'Drop the existing link instead of writing a new one.')
  .option('-y, --yes', 'Non-interactive. Fail rather than prompt when ambiguous.')
  .action(async (opts) => {
    const code = await runLinkCommand({
      projectId: opts.projectId,
      unlink: opts.unlink === true,
      yes: opts.yes === true
    });
    process.exit(code);
  });

program
  .command('uninstall')
  .description('Reverse `init`: strip the MCP server entry from picked clients, remove the unspa block from .gitignore / CLAUDE.md / AGENTS.md, uninstall bundled skills, optionally purge unspa/ and globally unlink the CLI.')
  .option('--clients <ids>', 'Comma list of client ids (e.g. claude-code,cursor,gemini) or "all".')
  .option('--purge', 'Also delete the unspa/ folder (your feature JSONs). Prompts unless --yes.')
  .option('--global-uninstall', 'Also run `npm uninstall -g unspaghettit` and sweep any leftover shims so the command leaves your PATH for good.')
  .option('-y, --yes', 'Skip the destructive-action confirmations.')
  .action(async (opts) => {
    const code = await runUninstallCommand({
      clients: opts.clients,
      purge: opts.purge === true,
      uninstallGlobal: opts.globalUninstall === true,
      yes: opts.yes === true
    });
    process.exit(code);
  });

// `view list|add|remove` — manage which opt-in dashboard views are enabled.
// Expert is always on; Builder (and future views) are opt-in. Enablement
// persists next to the model (`<snapshots>/views.json`) so it survives across
// dashboard runs. The header only shows a view switcher when more than one
// view is on, so removing the last opt-in view returns a single-view, no-toggle
// dashboard.
const view = program
  .command('view')
  .description('Manage which opt-in dashboard views are enabled (Expert is always on).');

view
  .command('list')
  .description('Show the opt-in views and whether each is enabled.')
  .option('-s, --snapshots <dir>', 'Target a specific snapshots folder (defaults to walk-up, then the shared hub).')
  .action(async (opts) => {
    process.exit(await runViewCommand({ action: 'list', snapshots: opts.snapshots }));
  });

view
  .command('add <id>')
  .description('Enable an opt-in view (e.g. "builder"). Persists so the dashboard keeps showing it.')
  .option('-s, --snapshots <dir>', 'Target a specific snapshots folder.')
  .action(async (id, opts) => {
    process.exit(await runViewCommand({ action: 'add', id, snapshots: opts.snapshots }));
  });

view
  .command('remove <id>')
  .description('Disable an opt-in view (e.g. "builder"). With no opt-in views left, the header drops the view switcher.')
  .option('-s, --snapshots <dir>', 'Target a specific snapshots folder.')
  .action(async (id, opts) => {
    process.exit(await runViewCommand({ action: 'remove', id, snapshots: opts.snapshots }));
  });

// `theme list|set|reset` — pick the dashboard's colour skin. Purely cosmetic
// (it never changes which features exist), persisted next to the model in
// `<snapshots>/theme.json` so `unspa dashboard` boots with it. The in-app
// header switcher flips it live in the browser without touching this file.
const theme = program
  .command('theme')
  .description('Pick the dashboard colour theme (cosmetic). The in-app header switcher can also flip it live.');

theme
  .command('list')
  .description('Show the available themes and which one is the persisted default.')
  .option('-s, --snapshots <dir>', 'Target a specific snapshots folder (defaults to walk-up, then the shared hub).')
  .action(async (opts) => {
    process.exit(await runThemeCommand({ action: 'list', snapshots: opts.snapshots }));
  });

theme
  .command('set <id>')
  .description('Set the dashboard theme (e.g. "classic"). Persists so `unspa dashboard` uses it.')
  .option('-s, --snapshots <dir>', 'Target a specific snapshots folder.')
  .action(async (id, opts) => {
    process.exit(await runThemeCommand({ action: 'set', id, snapshots: opts.snapshots }));
  });

theme
  .command('reset')
  .description('Revert to the default theme.')
  .option('-s, --snapshots <dir>', 'Target a specific snapshots folder.')
  .action(async (opts) => {
    process.exit(await runThemeCommand({ action: 'reset', snapshots: opts.snapshots }));
  });

// `scenarios export <featureId>` — generates a Vitest spec from the feature's
// scenarios, using the deterministic simulator as the assertion oracle. The
// user writes a thin adapter that calls their real implementation; the
// generated tests close the loop between spec and code so drift fails CI.
//
// EXPERIMENTAL: the adapter contract is still firming up. The command runs,
// the loop closes, but the public surface (UnspaAdapter + AdapterInvocation +
// AdapterResult) may shift between minor versions. Labeled as preview in
// `--help` and stamped into every generated file's header so CI doesn't
// pretend stability we haven't earned yet.
const scenarios = program
  .command('scenarios')
  .description('Tools that work with the scenarios authored on a feature.');

scenarios
  .command('export <featureId>')
  .description('[experimental] Generate a Vitest spec from a feature\'s scenarios. The simulator predicts each scenario\'s outcome and embeds it as the assertion oracle the user-written adapter is checked against. Adapter contract is preview and may change.')
  .option('-o, --out <path>', 'Output file path (absolute, or relative to cwd). Defaults to ./<feature-slug>.scenarios.spec.ts.')
  .option('-a, --adapter <importPath>', 'Module specifier the generated test imports the adapter from.', './unspa.adapter')
  .option('--adapter-export <name>', 'Named export inside the adapter module.', 'adapter')
  .option('--dry-run', 'Print the generated spec to stdout instead of writing it.')
  .option('-f, --force', 'Overwrite the output file if it already exists. Default refuses to clobber so hand-edited specs survive a re-run.')
  .action(async (featureId, opts) => {
    const code = await runScenariosExportCommand({
      featureId,
      out: opts.out,
      adapter: opts.adapter,
      adapterExport: opts.adapterExport,
      dryRun: opts.dryRun === true,
      force: opts.force === true
    });
    process.exit(code);
  });

scenarios
  .command('adapter <featureId>')
  .description('[experimental] Scaffold the UnspaAdapter stub for a feature: one case per scenario-bearing action, pre-seeded with the implementation location from .unspa.json. Fill the TODOs, then `scenarios export` + vitest closes the spec↔code loop. Refuses to clobber without --force.')
  .option('-o, --out <path>', 'Output file path. Defaults to ./unspa.adapter.ts (so the export command\'s default import resolves).')
  .option('--adapter-export <name>', 'Named export for the adapter.', 'adapter')
  .option('--dry-run', 'Print the generated adapter to stdout instead of writing it.')
  .option('-f, --force', 'Overwrite the output file if it already exists.')
  .action(async (featureId, opts) => {
    const code = await runScenariosAdapterCommand({
      featureId,
      out: opts.out,
      adapterExport: opts.adapterExport,
      dryRun: opts.dryRun === true,
      force: opts.force === true
    });
    process.exit(code);
  });

// `coverage ingest <file>` — close the spec↔code proof loop. Reads a Vitest
// JSON report of the generated scenario spec and stamps `verifiedAt` on the
// matching .unspa.json action entries, promoting them from "claimed
// implemented" to "proven against the spec". Gate on it with
// `unspa check --min-verified`.
const coverage = program
  .command('coverage')
  .description('Work with implementation coverage recorded in .unspa.json.');

coverage
  .command('ingest <resultsFile>')
  .description('[experimental] Read a Vitest JSON report (vitest run --reporter=json --outputFile=<file>) of the generated scenario spec and mark each action whose scenarios all passed as verified in .unspa.json (clears stale verifications that now fail). Recording only; gate with `unspa check --min-verified`.')
  .option('--dry-run', 'Report what would change without writing .unspa.json.')
  .action(async (resultsFile, opts) => {
    const code = await runCoverageIngestCommand({
      file: resultsFile,
      dryRun: opts.dryRun === true
    });
    process.exit(code);
  });

program.parseAsync(process.argv).catch((err) => {
  log.err((err as Error).message);
  process.exit(1);
});
