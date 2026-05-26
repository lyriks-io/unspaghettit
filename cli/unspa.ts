import { createRequire } from 'node:module';
import { Command } from 'commander';
import { runDashboardCommand } from './commands/dashboard';
import { runInitCommand } from './commands/init';
import { runLinkCommand } from './commands/link';
import { runListCommand } from './commands/list';
import { runScenariosExportCommand } from './commands/scenarios-export';
import { runServeCommand } from './commands/serve';
import { runUninstallCommand } from './commands/uninstall';
import { log } from './util/log';

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

// v0.1 surface:
//   init       scaffold unspa/ + register MCP with picked clients
//              + optional CLAUDE.md/AGENTS.md + skills. Fully idempotent.
//   serve      run the bundled MCP server on stdio. Used by the entry
//              `init` writes into each client's config.
//   dashboard  boot the SvelteKit dashboard from the unspa/ folder
//              discovered by walking up from cwd.
//   list       enumerate the features in the local unspa/ folder
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
  .description('Scaffold unspa/ folder, register the MCP server with picked AI clients, seed CLAUDE.md/AGENTS.md, install bundled skills. Safe to re-run.')
  .option('--clients <ids>', 'Comma list of client ids (e.g. claude-code,cursor,gemini) or "all".')
  .option('--scope <scope>', 'Where to register the MCP: "project" (default) or "global". Project pairs with the per-repo unspa/ this command scaffolds; global writes to ~/.claude.json etc. for power users who want the MCP attached in every project.', 'project')
  .option('--hub [path]', 'Use a shared snapshot hub instead of per-repo unspa/. Pass --hub for the default (~/.unspa-hub/unspa) or --hub <path> to override. The MCP entry written to every selected client carries UNSPA_SNAPSHOTS=<resolved-path>; the local unspa/ folder is NOT created. Required pairing for Claude Desktop.')
  .option('--no-gitignore', 'Skip the .gitignore additions.')
  .option('--no-context', 'Skip the CLAUDE.md / AGENTS.md context block additions.')
  .option('--no-skills', 'Skip installing the bundled unspa skills under .claude/skills/.')
  .option('--fun', 'Pre-check the opt-in narrative skills (worldbuild + worldplay) in the skill picker. Also implicitly on when the CLI is invoked as `unspaghettit`.')
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
      fun: opts.fun === true || FUN_MODE_BY_INVOCATION
    });
    process.exit(code);
  });

program
  .command('serve')
  .description('Run the bundled MCP server on stdio. Invoked by AI clients via the entry `init` writes into their MCP config.')
  .option('-s, --snapshots <dir>', 'Override the unspa/ folder location (defaults to walking up from CWD).')
  .action(async (opts) => {
    const code = await runServeCommand({ snapshots: opts.snapshots });
    process.exit(code);
  });

program
  .command('dashboard')
  .description('Boot the bundled SvelteKit dashboard pointing at this repo\'s unspa/ folder.')
  .option('-p, --port <port>', 'Port to bind (default: 3000).', (v) => Number.parseInt(v, 10))
  .option('-h, --host <host>', 'Host to bind (default: 127.0.0.1). Pass 0.0.0.0 to expose on the LAN; the dashboard has no auth, so do this only on trusted networks.')
  .action(async (opts) => {
    const code = await runDashboardCommand({ port: opts.port, host: opts.host });
    process.exit(code);
  });

program
  .command('list')
  .description('List the projects in the local unspa/ folder. Pass --json for a scriptable payload; interactive picker re-binds the repo link unless --no-interactive.')
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

program.parseAsync(process.argv).catch((err) => {
  log.err((err as Error).message);
  process.exit(1);
});
