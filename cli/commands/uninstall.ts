import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import pc from 'picocolors';
import { ALL_CLIENTS, clientById, type ClientAdapter } from '../clients/registry';
import { SERVER_NAME } from '../clients/constants';
import { ask } from '../util/ask';

// The npm package name (from package.json#name). `SERVER_NAME` is the
// in-config MCP server key — same word as the CLI command — but `npm
// uninstall -g` needs the actual package name. Keeping these distinct
// constants avoids a confusing rename if the CLI bin name ever changes
// independently from the npm package.
const NPM_PACKAGE_NAME = 'unspaghettit';

// Bin names declared in package.json#bin. Used by the orphan-shim sweep
// after `npm uninstall -g` so a previously-botched uninstall doesn't keep
// `unspa` on PATH via leftover `.cmd` / `.ps1` shims that npm forgot to
// clean up. Keep in sync with package.json#bin when adding or renaming bins.
const BIN_NAMES = ['unspa', 'unspaghettit', 'unspa-mcp'] as const;
import type { ConfigScope } from '../clients/types';
import { removeUnspaContextBlocks } from '../util/context-files';
import { removeGitignoreBlock } from '../util/gitignore';
import { removeMcpServerEntry } from '../util/json';
import { linkPath, removeRepoLink } from '../util/link';
import { log } from '../util/log';
import { removeUnspaSkills } from '../util/skills';

export type UninstallOptions = {
  readonly cwd?: string;
  readonly clients?: string;
  readonly yes?: boolean;
  readonly uninstallGlobal?: boolean;
  readonly purge?: boolean;
};

const resolveClients = (raw: string | undefined): readonly ClientAdapter[] => {
  if (!raw || raw === 'all') return ALL_CLIENTS;
  // `none` matches the init.ts opt-out so users can run uninstall to clean
  // up gitignore / context / skills without touching any client config.
  if (raw === 'none') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => {
      const c = clientById(id);
      if (!c) log.warn(`Unknown client id: ${id}`);
      return c;
    })
    .filter((c): c is ClientAdapter => c !== null);
};

const ALL_SCOPES: readonly ConfigScope[] = ['project', 'global'];

const npmBin = (): string => (process.platform === 'win32' ? 'npm.cmd' : 'npm');

const runNpm = (args: readonly string[]): Promise<number> =>
  new Promise<number>((resolvePromise) => {
    const child = spawn(npmBin(), Array.from(args), {
      stdio: 'inherit',
      shell: process.platform === 'win32'
    });
    child.on('exit', (code) => resolvePromise(code ?? 0));
    child.on('error', () => resolvePromise(1));
  });

const npmPrefix = async (): Promise<string | null> =>
  new Promise<string | null>((resolvePromise) => {
    const child = spawn(npmBin(), ['config', 'get', 'prefix'], {
      shell: process.platform === 'win32'
    });
    let out = '';
    child.stdout?.on('data', (chunk) => {
      out += chunk.toString();
    });
    child.on('exit', () => resolvePromise(out.trim() || null));
    child.on('error', () => resolvePromise(null));
  });

/**
 * Belt-and-braces shim sweep after `npm uninstall -g`. The Windows-specific
 * failure mode: an interrupted install, a stale `npm link`, or any flow that
 * removes `node_modules\unspaghettit\` *without* clearing the bin shims in
 * `npm config get prefix` leaves `.cmd` / `.ps1` / POSIX shims pointing at a
 * folder that no longer exists. `npm uninstall -g` is then a silent no-op
 * (npm has no record of the package) and the user keeps finding `unspa` on
 * PATH after what looked like a successful uninstall. We only target the
 * exact bins declared in `package.json#bin` so we never delete an unrelated
 * file the user happens to have in their npm prefix.
 */
const sweepOrphanShims = (prefix: string): readonly string[] => {
  const exts = process.platform === 'win32' ? ['', '.cmd', '.ps1'] : [''];
  const removed: string[] = [];
  for (const name of BIN_NAMES) {
    for (const ext of exts) {
      const p = join(prefix, `${name}${ext}`);
      if (!existsSync(p)) continue;
      try {
        rmSync(p, { force: true });
        removed.push(p);
      } catch {
        // Read-only or in-use shim. Surface to the caller as "still here" by
        // not adding it to `removed`; the post-condition log line tells the
        // user to retry once the file isn't held by another process.
      }
    }
  }
  return removed;
};

const npmUninstallGlobal = async (): Promise<number> => {
  // Run the real npm uninstall first. Covers both `npm install -g` and
  // `npm link` installs (both leave a folder/symlink in npm's global
  // node_modules that uninstall removes). When npm has no record of the
  // package — which is exactly the orphan-shim case — this exits 0 silently
  // and we fall through to the shim sweep below.
  const code = await runNpm(['uninstall', '-g', NPM_PACKAGE_NAME]);
  const prefix = await npmPrefix();
  if (prefix) {
    const removed = sweepOrphanShims(prefix);
    for (const p of removed) log.ok(`Swept leftover shim ${p}`);
    if (removed.length === 0) log.dim('No leftover shims in npm prefix.');
  } else {
    log.warn('Could not resolve npm prefix; skipped orphan-shim sweep.');
  }
  return code;
};

export const runUninstallCommand = async (options: UninstallOptions = {}): Promise<number> => {
  const cwd = options.cwd ?? process.cwd();
  const home = homedir();
  const yes = options.yes === true;

  log.step(`Uninstalling Unspaghettit from ${pc.cyan(cwd)}`);

  // 1. Strip MCP server entries from every selected client Ã- scope.
  const clients = resolveClients(options.clients);
  for (const client of clients) {
    for (const scope of ALL_SCOPES) {
      if (!client.scopes.includes(scope)) continue;
      const path = client.resolvePath(scope, { cwd, home });
      if (!path) continue;
      try {
        const changed = await removeMcpServerEntry(path, SERVER_NAME);
        if (changed) log.ok(`${client.label} (${scope}): removed entry from ${path}`);
        else log.dim(`${client.label} (${scope}): nothing to remove (${path})`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`${client.label} (${scope}): ${message}`);
      }
    }
  }

  // 2. Strip the unspa block from .gitignore.
  const gi = removeGitignoreBlock(cwd);
  if (gi.changed) log.ok('Removed unspa block from .gitignore');
  else log.dim('No unspa block in .gitignore');

  // 3. Strip the unspa block from CLAUDE.md / AGENTS.md.
  const ctx = removeUnspaContextBlocks(cwd);
  for (const r of ctx) {
    const rel = relative(cwd, r.path) || r.path;
    if (r.changed) log.ok(`Removed unspa block from ${rel}`);
    else log.dim(`No unspa block in ${rel}`);
  }

  // 4. Remove bundled skills.
  const skills = removeUnspaSkills(cwd);
  for (const r of skills) {
    if (r.removed) log.ok(`Removed skill ${pc.cyan(r.name)} from ${relative(cwd, r.path) || r.path}`);
    else log.dim(`Skill ${r.name} not present`);
  }

  // 5. Remove the repo→project link.
  const linkRemoval = removeRepoLink(cwd);
  if (linkRemoval.changed) log.ok(`Removed ${relative(cwd, linkPath(cwd))}`);
  else log.dim('No repo link to remove');

  // 6. Optionally delete the unspa/ folder.
  if (options.purge) {
    const unspaDir = join(cwd, 'unspa');
    if (existsSync(unspaDir)) {
      const ok = yes
        ? true
        : (
            await ask({
              type: 'confirm',
              name: 'apply',
              message: `Delete ${unspaDir} and ALL feature JSONs? This cannot be undone.`,
              initial: false
            })
          ).apply;
      if (ok) {
        rmSync(unspaDir, { recursive: true, force: true });
        log.ok(`Deleted ${unspaDir}`);
      } else {
        log.dim('Kept unspa/ folder');
      }
    } else {
      log.dim('No unspa/ folder to purge');
    }
  }

  // 7. Optionally uninstall the CLI globally. `npm uninstall -g` does the
  //    right thing for both `npm install -g` and `npm link` installs, then
  //    we sweep any leftover shims in npm's prefix so a previously orphaned
  //    install can't keep `unspa` on PATH after this command claims success.
  if (options.uninstallGlobal) {
    log.blank();
    log.step(`Uninstalling Unspaghettit CLI globally (npm uninstall -g ${NPM_PACKAGE_NAME})`);
    log.dim('This removes the `unspa`, `unspaghettit`, and `unspa-mcp` commands from your PATH. The current process keeps running.');
    const code = await npmUninstallGlobal();
    if (code === 0) log.ok('CLI uninstalled.');
    else log.warn(`npm uninstall exited with code ${code}.`);
  }

  log.blank();
  log.ok('Unspaghettit uninstalled from this project.');
  if (!options.uninstallGlobal) {
    log.dim('Run with --global-uninstall to also remove the `unspa` command from PATH.');
  }
  if (!options.purge) {
    log.dim('Run with --purge to also delete the unspa/ folder (your feature JSONs).');
  }
  return 0;
};
