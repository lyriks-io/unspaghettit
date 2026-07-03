import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * Client presence detection helpers, shared by the adapters' `detect()`.
 *
 * The original signal was "does this client's config directory exist yet",
 * which only becomes true after the client has been launched at least once and
 * written its config. On a fresh machine - install the tool, run the unspa
 * bootstrap, then open the tool - that ordering means detection misses a client
 * the user very much has. These helpers add the stronger signals: a client's
 * CLI on PATH, or its app install directory on disk, both true from the moment
 * the tool is installed.
 */

/** Windows executable extensions to probe, from PATHEXT (with sane fallback). */
const windowsExecExts = (env: NodeJS.ProcessEnv): string[] => {
  const raw = env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD';
  return raw
    .split(';')
    .map((e) => e.trim())
    .filter(Boolean);
};

/**
 * Is `name` an executable resolvable on the current PATH? Mirrors how a shell
 * resolves a bare command: scan each PATH entry, and on Windows try each
 * PATHEXT extension (plus the bare name). `env` is injectable for testing.
 */
export const isCommandOnPath = (name: string, env: NodeJS.ProcessEnv = process.env): boolean => {
  const pathVar = env.PATH ?? env.Path ?? env.path ?? '';
  if (!pathVar) return false;
  const dirs = pathVar.split(delimiter).filter(Boolean);
  const candidates =
    process.platform === 'win32' ? ['', ...windowsExecExts(env)].map((ext) => `${name}${ext}`) : [name];
  for (const dir of dirs) {
    for (const candidate of candidates) {
      if (existsSync(join(dir, candidate))) return true;
    }
  }
  return false;
};

/** True when any of the given paths exists. Convenience for app-dir probes. */
export const pathExistsAny = (paths: readonly string[]): boolean => paths.some((p) => existsSync(p));
