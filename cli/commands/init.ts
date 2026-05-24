import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve as resolvePath } from 'node:path';
import pc from 'picocolors';
import { ALL_CLIENTS, clientById, SERVER_NAME, type ClientAdapter } from '../clients/registry';
import { buildUnspaMcpEntry } from '../clients/claude-code';
import type { ApplyResult, ConfigScope, McpServerEntry } from '../clients/types';
import { ask } from '../util/ask';
import { writeUnspaContextBlocks } from '../util/context-files';
import { upsertGitignoreBlock } from '../util/gitignore';
import { log } from '../util/log';
import { installUnspaSkills } from '../util/skills';

/**
 * Default shared-hub layout: `<home>/.unspa-hub/unspa`. The `unspa` subfolder
 * is the snapshot directory (the MCP entry's `UNSPA_SNAPSHOTS` points here);
 * the `.unspa-hub` parent is where `unspa dashboard` should be launched from
 * so its walk-up discovery finds the same folder.
 */
const DEFAULT_HUB_ROOT_SEGMENT = '.unspa-hub';
const HUB_SNAPSHOTS_SEGMENT = 'unspa';

const defaultHubPath = (home: string): string =>
  join(home, DEFAULT_HUB_ROOT_SEGMENT, HUB_SNAPSHOTS_SEGMENT);

/**
 * Expand a user-supplied hub path: tilde-expansion, relative→absolute (resolved
 * against `cwd`), passthrough for absolute paths. Keeps the MCP entry's
 * `UNSPA_SNAPSHOTS` always absolute so AI clients launching from elsewhere
 * still find the right folder.
 */
const resolveHubPath = (raw: string, home: string, cwd: string): string => {
  const trimmed = raw.trim();
  if (trimmed === '~') return join(home, DEFAULT_HUB_ROOT_SEGMENT, HUB_SNAPSHOTS_SEGMENT);
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
   * Shared snapshot hub mode. When set, the MCP entry written to every
   * selected client carries `UNSPA_SNAPSHOTS=<resolved hub path>`, the local
   * `unspa/` folder is NOT created in this repo, and the dashboard is meant to
   * be launched from one well-known location pointing at the same folder.
   *
   * - `undefined`: per-repo mode (default). Today's behavior.
   * - `true`: hub mode using the default path (`~/.unspa-hub/unspa`).
   * - `string`: hub mode with a user-supplied absolute or `~/`-prefixed path.
   *
   * Required pairing for Claude Desktop, which has no project-scoped MCP
   * config and no useful cwd at launch time - without an absolute env var
   * its MCP would always discover whatever folder happens to be near it.
   */
  readonly hub?: boolean | string;
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
 * Resolve the shared-hub setting to an absolute snapshot directory (or
 * `null` for per-repo mode). Three input shapes:
 *
 * - `undefined`: prompt the user interactively when running with a TTY.
 *   With `--yes`, default to per-repo (null).
 * - `true`: hub mode at the default path, no prompting.
 * - `string`: explicit hub path. Tilde / relative paths get expanded.
 *
 * Returns null when the user opts out or hub mode is not requested.
 */
const resolveHub = async (
  opt: boolean | string | undefined,
  yes: boolean,
  ctx: { home: string; cwd: string }
): Promise<string | null> => {
  if (typeof opt === 'string' && opt.length > 0) return resolveHubPath(opt, ctx.home, ctx.cwd);
  if (opt === true) return defaultHubPath(ctx.home);
  if (yes) return null;

  const { useHub } = await ask({
    type: 'confirm',
    name: 'useHub',
    message: 'Use a shared snapshot hub instead of this repo\'s unspa/ folder?',
    initial: false,
    hint: 'one folder, many repos / Claude Desktop; press n to keep the per-repo default'
  });
  if (!useHub) return null;

  const suggested = defaultHubPath(ctx.home);
  const { hubPath } = await ask({
    type: 'text',
    name: 'hubPath',
    message: 'Hub snapshot directory:',
    initial: suggested,
    hint: 'absolute path; ~/ expands to your home directory'
  });
  if (typeof hubPath !== 'string' || hubPath.trim().length === 0) return suggested;
  return resolveHubPath(hubPath, ctx.home, ctx.cwd);
};

export const runInitCommand = async (options: InitOptions = {}): Promise<number> => {
  const cwd = options.cwd ?? process.cwd();
  const home = homedir();
  const yes = options.yes === true;

  log.step(`Initializing Unspaghettit in ${pc.cyan(cwd)}`);

  // 1. Resolve hub mode FIRST. If a hub is in play, we skip creating a local
  //    unspa/ (it would shadow the hub via walk-up discovery whenever the env
  //    var dropped out) and pin every MCP entry to the hub's absolute path.
  const hubPath = await resolveHub(options.hub, yes, { home, cwd });

  if (hubPath) {
    if (!existsSync(hubPath)) {
      mkdirSync(hubPath, { recursive: true });
      log.ok(`Created hub snapshots folder ${pc.cyan(hubPath)}`);
    } else {
      log.dim(`Using existing hub snapshots folder ${hubPath}`);
    }
    log.dim(`Skipping local unspa/ - MCP entries will set UNSPA_SNAPSHOTS=${hubPath}`);
  } else {
    // Per-repo mode: ensure unspa/ folder exists. mkdirSync recursive is idempotent.
    const unspaDir = join(cwd, 'unspa');
    if (!existsSync(unspaDir)) {
      mkdirSync(unspaDir, { recursive: true });
      log.ok(`Created ${pc.cyan('unspa/')} folder`);
    } else {
      log.dim(`unspa/ already exists`);
    }
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
    const entry = buildUnspaMcpEntry(hubPath ? { env: { UNSPA_SNAPSHOTS: hubPath } } : {});
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
  const wantsSkills = clients.some((c) => c.installsSkills === true);
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
      const results = installUnspaSkills(cwd);
      if (results.length === 0) {
        log.warn('No bundled skills found in this CLI install.');
      } else {
        for (const r of results) log.ok(`Installed skill ${pc.cyan(r.name)} → ${relative(cwd, r.path) || r.path}`);
      }
    }
  }

  log.blank();
  log.ok('Unspaghettit initialized.');
  if (hubPath) {
    // The dashboard discovers `unspa/` by walking up from cwd. When the hub
    // snapshot dir is `<root>/unspa`, launching from `<root>` is what makes
    // the dashboard see the same folder the MCP entries now point at.
    const hubRoot = resolvePath(hubPath, '..');
    log.dim(`Hub mode: run \`unspa dashboard\` from ${pc.cyan(hubRoot)} so it discovers the same snapshots.`);
    log.dim(`Restart your AI clients to pick up the new MCP entry.`);
  } else {
    log.dim('Next: `unspa dashboard` to open the UI, or start talking to your LLM with the MCP attached.');
    log.dim('New to MCP? Ask Claude Code: "Verify the unspa MCP tools are available in this repo." Restart the client if it does not see them yet.');
  }
  return 0;
};
