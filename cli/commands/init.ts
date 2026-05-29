import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve as resolvePath } from 'node:path';
import pc from 'picocolors';
import { defaultHubDirectory } from '../../src/features/behavior-model/infrastructure/persistence/snapshot-discovery';
import { ALL_CLIENTS, clientById, SERVER_NAME, type ClientAdapter } from '../clients/registry';
import { buildUnspaMcpEntry } from '../clients/claude-code';
import type { ApplyResult, ConfigScope, McpServerEntry } from '../clients/types';
import { ask } from '../util/ask';
import { writeUnspaContextBlocks } from '../util/context-files';
import { upsertGitignoreBlock } from '../util/gitignore';
import { log } from '../util/log';
import { installUnspaSkills } from '../util/skills';

/**
 * Expand a user-supplied hub path: tilde-expansion, relative→absolute (resolved
 * against `cwd`), passthrough for absolute paths. Keeps the MCP entry's
 * `UNSPA_SNAPSHOTS` always absolute so AI clients launching from elsewhere
 * still find the right folder.
 */
const resolveHubPath = (raw: string, home: string, cwd: string): string => {
  const trimmed = raw.trim();
  if (trimmed === '~') return defaultHubDirectory(home);
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return join(home, trimmed.slice(2));
  }
  if (isAbsolute(trimmed)) return trimmed;
  return resolvePath(cwd, trimmed);
};

/**
 * Treat a client as "present" only when its adapter reports an on-disk signal
 * (existing config dir for either scope). Adapters that don't implement
 * `detect` - Codex VS Code - fall through as undetected. Used to
 * pre-select sensible defaults in the interactive prompt AND to scope the
 * `--yes` non-interactive run, so neither path silently creates dotfolders
 * (`.kiro/`, `.cursor/`, `.gemini/`, ...) for AI clients the user has never
 * installed.
 */
const isClientDetected = (
  client: ClientAdapter,
  params: { cwd: string; home: string }
): boolean => client.detect?.(params) ?? false;

// Init scope: scaffold the unspa/ folder, register the MCP server with
// picked AI clients, write idempotent gitignore + CLAUDE.md/AGENTS.md
// blocks, and install bundled skills. Every step is safe to re-run; markers
// + merge semantics mean nothing duplicates. Binding the repo to a
// specific project lives in `unspa link` as a follow-up step so the user
// runs it once they've actually created (or picked) a project.

const GITIGNORE_ENTRIES = [
  '# Unspaghettit scratch / hot-reload artefacts',
  'unspa/*.implementation-status.json',
  'stdout.tmp',
  'stderr.tmp'
];

export type InitOptions = {
  readonly cwd?: string;
  /** Comma list of client ids, or 'all', or undefined to prompt. */
  readonly clients?: string;
  /**
   * Where to write the MCP server entry. Defaults to 'project' (per-repo
   * `.mcp.json`). Pass `'global'` to write to `~/.claude.json` / `~/.cursor/`
   * etc. for advanced workflows where the MCP should attach to every project.
   * Most users never set this - the default pairs with the per-project
   * `unspa/` folder, skills, and CLAUDE.md block that this command also writes.
   */
  readonly scope?: ConfigScope;
  /** When set, skip prompts and use sensible defaults (CI / scripts). */
  readonly yes?: boolean;
  /** When set, skip the .gitignore additions. */
  readonly skipGitignore?: boolean;
  /** When set, skip the CLAUDE.md / AGENTS.md context block additions. */
  readonly skipContext?: boolean;
  /** When set, skip installing the bundled skills under .claude/skills/. */
  readonly skipSkills?: boolean;
  /**
   * Shared snapshot hub override. Hub mode is now the DEFAULT (see the module
   * comment): discovery falls back to `~/.unspa-hub/unspa` with no env var, so
   * the bare `init` writes a clean MCP entry and the dashboard/MCP agree on the
   * first run. This option only matters when you want a NON-default location:
   *
   * - `undefined`: default hub (`~/.unspa-hub/unspa`), no `UNSPA_SNAPSHOTS`.
   * - `true`: same as undefined - the default hub, explicit.
   * - `string`: a custom hub path. Because discovery's fallback is the *default*
   *   hub, a custom path can't be found by walk-up, so the MCP entry written to
   *   every selected client carries `UNSPA_SNAPSHOTS=<resolved path>`.
   */
  readonly hub?: boolean | string;
  /**
   * Per-repo (custom) install: scaffold a local `unspa/` folder in this repo
   * and rely on discovery's walk-up to find it, exactly like the pre-hub
   * default. No `UNSPA_SNAPSHOTS` is written - the model travels with the repo
   * in git. This is the opt-in escape hatch from the shared hub.
   */
  readonly local?: boolean;
  /**
   * Launch the interactive custom-install wizard: choose between the default
   * hub, a per-repo `unspa/`, or a custom hub path, plus the config scope.
   * Ignored under `--yes`. Without it (and without `--local`/`--hub <path>`),
   * `init` takes the zero-question happy path: default hub.
   */
  readonly custom?: boolean;
  /**
   * Pre-check the opt-in narrative skills (worldbuild + worldplay) at the
   * skill installation prompt. Set when the user invoked the CLI as
   * `unspaghettit` (the package's long-name bin alias) or passed `--fun`.
   * With `--yes` this also bypasses the prompt and installs them directly.
   */
  readonly fun?: boolean;
};

const resolveClientsArg = async (
  raw: string | undefined,
  yes: boolean,
  detectParams: { cwd: string; home: string }
): Promise<readonly ClientAdapter[]> => {
  if (raw) {
    if (raw === 'all') return ALL_CLIENTS;
    // Explicit opt-out keyword. Avoids the contradictory "Unknown client id:
    // none / No clients selected" pair when the user wants to scaffold the
    // unspa/ folder + context blocks without touching any AI client config.
    if (raw === 'none') return [];
    const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
    const resolved: ClientAdapter[] = [];
    for (const id of ids) {
      const c = clientById(id);
      if (!c) log.warn(`Unknown client id: ${id}`);
      else resolved.push(c);
    }
    return resolved;
  }
  // Non-interactive (CI / `--yes`): only the AI clients we can see on disk.
  // Users who want every adapter wired up can still pass `--clients=all`.
  if (yes) return ALL_CLIENTS.filter((c) => isClientDetected(c, detectParams));

  // Interactive: keep every adapter visible so the user can opt in, but
  // pre-select only the ones already installed. Hitting enter on a fresh
  // machine no longer carpets the repo with `.kiro/`, `.cursor/`, `.gemini/`
  // for tools the user doesn't use.
  const choices = ALL_CLIENTS.map((c) => ({
    title: c.label,
    value: c.id,
    selected: isClientDetected(c, detectParams),
    description: c.note
  }));
  const anyDetected = choices.some((c) => c.selected);
  const answer = await ask({
    type: 'multiselect',
    name: 'clients',
    message: 'Which AI clients should `unspa` be registered with?',
    choices,
    instructions: false,
    hint: anyDetected
      ? 'space to toggle, enter to confirm (pre-selected = detected on disk)'
      : 'space to toggle, enter to confirm (none detected on disk - pick manually)'
  });
  const ids: string[] = answer.clients ?? [];
  return ids.map((id) => clientById(id)).filter((c): c is ClientAdapter => c !== null);
};

// Always project unless the user explicitly opts into global. The two scopes
// are not symmetric in practice: project scope pairs naturally with the
// per-project `unspa/` folder + skills + CLAUDE.md block that `init` writes
// in the same run, while global scope is for advanced workflows that want the
// MCP attached to every Claude Code / Cursor session by default. Surfacing it
// as a prompt added friction for no benefit on the happy path; keeping it as
// an opt-in flag preserves the capability without bothering anyone.
const resolveScope = (opt: ConfigScope | undefined): ConfigScope => opt ?? 'project';

/**
 * Render the MCP server entry the user must paste into a client that has no
 * file-based config we can auto-merge (Codex VS Code). The
 * snippet matches the shape every other adapter writes so users can drop it
 * straight into the host's connector UI / settings JSON.
 */
const renderManualSnippet = (entry: McpServerEntry): string => {
  const payload = { mcpServers: { [SERVER_NAME]: entry } };
  return JSON.stringify(payload, null, 2);
};

const printApplyResult = (
  client: ClientAdapter,
  scope: ConfigScope,
  r: ApplyResult,
  entry: McpServerEntry
): void => {
  if (r.skipped === 'unsupported-scope') {
    log.dim(`  ${client.label} (${scope}): scope not supported by this client`);
    return;
  }
  if (r.skipped === 'unimplemented') {
    log.warn(`  ${client.label} (${scope}): manual setup required`);
    if (r.note) log.dim(`    ${r.note}`);
    log.dim('    Paste this snippet into the client\'s MCP settings:');
    for (const line of renderManualSnippet(entry).split('\n')) {
      log.dim(`      ${line}`);
    }
    return;
  }
  if (r.changed) log.ok(`  ${client.label} (${scope}): wrote ${r.path}`);
  else log.dim(`  ${client.label} (${scope}): already up to date (${r.path})`);
};

/**
 * Where this install's behavior model lives.
 *
 * - `hub`: the shared default hub (`~/.unspa-hub/unspa`). `setEnv` is false -
 *   discovery's fallback already lands here, so the MCP entry stays clean.
 * - `custom-hub`: a non-default hub path. `setEnv` is true - walk-up can't find
 *   it, so every MCP entry pins `UNSPA_SNAPSHOTS` to the absolute path.
 * - `local`: a per-repo `unspa/` folder, found by walk-up. `setEnv` is false -
 *   the model travels with the repo, no absolute path baked into config.
 */
type SnapshotTarget = {
  readonly mode: 'hub' | 'custom-hub' | 'local';
  readonly dir: string;
  readonly setEnv: boolean;
};

/**
 * Decide where snapshots live. The happy path (no `--custom`, no `--local`, no
 * `--hub <path>`) is the zero-question default hub. Explicit flags win without
 * prompting; `--custom` opens the interactive picker when a TTY is available.
 */
const resolveTarget = async (
  options: InitOptions,
  yes: boolean,
  ctx: { home: string; cwd: string }
): Promise<SnapshotTarget> => {
  const hubDir = defaultHubDirectory(ctx.home);

  // Explicit, non-interactive flags take precedence in priority order.
  if (typeof options.hub === 'string' && options.hub.length > 0) {
    return { mode: 'custom-hub', dir: resolveHubPath(options.hub, ctx.home, ctx.cwd), setEnv: true };
  }
  if (options.local === true) {
    return { mode: 'local', dir: join(ctx.cwd, 'unspa'), setEnv: false };
  }
  // `--hub` with no value, or no custom request at all: the default hub.
  if (options.hub === true || (!options.custom && !options.local)) {
    return { mode: 'hub', dir: hubDir, setEnv: false };
  }

  // `--custom` (interactive). Under --yes there's no TTY: keep the safe default.
  if (yes) return { mode: 'hub', dir: hubDir, setEnv: false };

  const { choice } = await ask({
    type: 'select',
    name: 'choice',
    message: 'Where should this project\'s behavior model live?',
    choices: [
      { title: 'Shared hub (default)', value: 'hub', description: hubDir },
      { title: 'This repo (per-repo unspa/ folder)', value: 'local', description: join(ctx.cwd, 'unspa') },
      { title: 'A custom hub path', value: 'custom-hub', description: 'pick any folder' }
    ],
    initial: 0
  });

  if (choice === 'local') return { mode: 'local', dir: join(ctx.cwd, 'unspa'), setEnv: false };
  if (choice === 'custom-hub') {
    const { hubPath } = await ask({
      type: 'text',
      name: 'hubPath',
      message: 'Hub snapshot directory:',
      initial: hubDir,
      hint: 'absolute path; ~/ expands to your home directory'
    });
    const raw = typeof hubPath === 'string' && hubPath.trim().length > 0 ? hubPath : hubDir;
    return { mode: 'custom-hub', dir: resolveHubPath(raw, ctx.home, ctx.cwd), setEnv: true };
  }
  return { mode: 'hub', dir: hubDir, setEnv: false };
};

export const runInitCommand = async (options: InitOptions = {}): Promise<number> => {
  const cwd = options.cwd ?? process.cwd();
  const home = homedir();
  const yes = options.yes === true;

  log.step(`Initializing Unspaghettit in ${pc.cyan(cwd)}`);

  // 1. Resolve WHERE snapshots live. Default is the shared hub (zero config);
  //    `--local` keeps a per-repo unspa/; `--hub <path>` / `--custom` pick a
  //    non-default location. Only a custom hub path needs UNSPA_SNAPSHOTS - the
  //    default hub is discovery's fallback and a per-repo unspa/ is found by
  //    walk-up, so both stay out of the MCP entry's env.
  const target = await resolveTarget(options, yes, { home, cwd });

  if (!existsSync(target.dir)) {
    mkdirSync(target.dir, { recursive: true });
    log.ok(`Created snapshots folder ${pc.cyan(target.dir)}`);
  } else {
    log.dim(`Using existing snapshots folder ${target.dir}`);
  }
  if (target.mode === 'hub') {
    log.dim('Shared hub is the default - no UNSPA_SNAPSHOTS needed; the MCP and dashboard discover it automatically.');
  } else if (target.mode === 'custom-hub') {
    log.dim(`Custom hub - MCP entries will set UNSPA_SNAPSHOTS=${target.dir}`);
  } else {
    log.dim('Per-repo mode - the model lives in this repo and is found by walk-up (no UNSPA_SNAPSHOTS).');
  }

  // 2. Pick clients, write MCP server entry. `mergeMcpServerEntry` compares
  //    before writing so re-runs are a no-op when nothing changed. Detection
  //    is scoped to this cwd/home so the pre-selection (interactive) and the
  //    `--yes` filter both reflect what's actually installed.
  const clients = await resolveClientsArg(options.clients, yes, { cwd, home });
  if (clients.length === 0) {
    log.warn('No clients selected. Skipping MCP registration.');
  } else {
    const scope = resolveScope(options.scope);
    log.step(`Registering MCP server with ${clients.length} client(s) (${scope})`);
    const entry = buildUnspaMcpEntry(target.setEnv ? { env: { UNSPA_SNAPSHOTS: target.dir } } : {});
    for (const client of clients) {
      if (!client.scopes.includes(scope)) {
        log.dim(`  ${client.label} (${scope}): scope unsupported`);
        continue;
      }
      try {
        const result = await client.apply(scope, { cwd, home, serverEntry: entry });
        printApplyResult(client, scope, result, entry);
      } catch (err) {
        // A malformed existing config (hand-edited, truncated, ...) shouldn't
        // abort the whole init. Same posture as uninstall: warn + keep going
        // so the remaining clients still get registered.
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`  ${client.label} (${scope}): ${message}`);
      }
    }
  }

  // 3. Propose .gitignore additions. Block-marker upsert; safe to re-run.
  if (!options.skipGitignore) {
    const apply = yes
      ? true
      : (
          await ask({
            type: 'confirm',
            name: 'apply',
            message: 'Add Unspaghettit entries to .gitignore?',
            initial: true
          })
        ).apply;
    if (apply) {
      const { changed, created } = upsertGitignoreBlock(cwd, GITIGNORE_ENTRIES);
      if (changed) log.ok(created ? 'Created .gitignore' : 'Updated .gitignore');
      else log.dim('.gitignore already up to date');
    }
  }

  // 4. Insert managed Unspaghettit block into CLAUDE.md AND AGENTS.md. Both,
  //    unconditionally - AGENTS.md is the cross-tool standard (Cursor / Gemini
  //    / Kiro / Windsurf / Codex, and even Claude as a fallback) and CLAUDE.md
  //    is Claude-specific, so writing both means switching AI clients later
  //    needs zero re-init. HTML-comment markers scope the managed region so
  //    re-runs only refresh that block - handwritten content in the rest of
  //    each file is preserved, and a missing file is created.
  if (!options.skipContext) {
    const apply = yes
      ? true
      : (
          await ask({
            type: 'confirm',
            name: 'apply',
            message: 'Add Unspaghettit instructions to CLAUDE.md and AGENTS.md?',
            initial: true
          })
        ).apply;
    if (apply) {
      const results = writeUnspaContextBlocks(cwd);
      for (const r of results) {
        const rel = relative(cwd, r.path) || r.path;
        if (r.changed) log.ok(`${r.created ? 'Created' : 'Updated'} ${rel}`);
        else log.dim(`${rel} already up to date`);
      }
    }
  }

  // 5. Install bundled skills under .claude/skills/, but only when at least
  //    one selected client reads that layout (currently Claude). copyFileSync
  //    overwrites in place, so re-runs always land the current bundled version
  //    without accumulating duplicates.
  //
  //    Narrative skills (worldbuild + worldplay) are opt-in: gated behind fun
  //    mode (CLI invoked as `unspaghettit`, --fun, or interactive opt-in).
  //    Keeps the default install lean for software-spec users; lets narrative
  //    users have them with zero friction once they notice the unlock.
  const wantsSkills = clients.some((c) => c.installsSkills === true);
  const fun = options.fun === true;
  if (!options.skipSkills && wantsSkills) {
    const apply = yes
      ? true
      : (
          await ask({
            type: 'confirm',
            name: 'apply',
            message: 'Install Unspaghettit skills under .claude/skills/?',
            initial: true
          })
        ).apply;
    if (apply) {
      const includeNarrative = yes
        ? fun
        : (
            await ask({
              type: 'confirm',
              name: 'includeNarrative',
              message: 'Also install the narrative skills (worldbuild + worldplay)?',
              initial: fun,
              hint: 'Opt-in. Lets the LLM model and play interactive worlds. See "Definitely Do Not Use This For Fun" in the README.'
            })
          ).includeNarrative;
      const results = installUnspaSkills(cwd, { includeNarrative });
      if (results.length === 0) {
        log.warn('No bundled skills found in this CLI install.');
      } else {
        for (const r of results) log.ok(`Installed skill ${pc.cyan(r.name)} → ${relative(cwd, r.path) || r.path}`);
      }
    }
  }

  log.blank();
  log.ok('Unspaghettit initialized.');
  if (target.mode === 'hub') {
    log.dim('Next: `unspa dashboard` (from anywhere) to open the UI, or start talking to your LLM with the MCP attached.');
    log.dim('Both resolve the shared hub automatically. To point at a different folder later: re-run `unspa init --hub <path>`, or `unspa dashboard --snapshots <path>` for a one-off.');
    log.dim('New to MCP? Ask Claude Code: "Verify the unspa MCP tools are available in this repo." Restart the client if it does not see them yet.');
  } else if (target.mode === 'custom-hub') {
    log.dim(`Custom hub at ${pc.cyan(target.dir)}. Run \`unspa dashboard --snapshots ${target.dir}\` (or set UNSPA_SNAPSHOTS) so the UI sees the same folder.`);
    log.dim('Restart your AI clients to pick up the new MCP entry. To switch later, re-run `unspa init --hub <path>` or `unspa init` for the default hub.');
  } else {
    log.dim('Per-repo mode: run `unspa dashboard` from this repo so its walk-up finds the local unspa/ folder.');
    log.dim('To move this project into the shared hub later, re-run `unspa init` (the default).');
  }
  return 0;
};
