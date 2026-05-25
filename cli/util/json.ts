import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import writeFileAtomic from 'write-file-atomic';

/**
 * Read JSON, returning `null` when the file is missing or unparseable. We
 * never throw on a malformed config. The merge layer treats it as "start
 * fresh" rather than refusing to write.
 */
export const readJson = <T>(path: string): T | null => {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
};

export const writeJson = async (path: string, value: unknown): Promise<void> => {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

/**
 * Idempotent merge into `mcpServers.<name>` while preserving any other
 * servers the user already configured for the host. Returns true when the
 * file content changed (so the caller can log "wrote" vs "already up to date").
 *
 * `entry` is typed as `unknown` because we don't introspect it — we just
 * serialize it under the chosen key. Callers pass strongly-typed shapes
 * (e.g. `McpServerEntry` from `./clients/types`); the boundary is honest
 * about what this helper actually inspects.
 */
export const mergeMcpServerEntry = async (
  path: string,
  serverName: string,
  entry: unknown
): Promise<boolean> => {
  const current = readJson<{ mcpServers?: Record<string, unknown> }>(path) ?? {};
  const existing = current.mcpServers?.[serverName];
  const next = {
    ...current,
    mcpServers: { ...(current.mcpServers ?? {}), [serverName]: entry }
  };
  if (JSON.stringify(existing) === JSON.stringify(entry)) return false;
  await writeJson(path, next);
  return true;
};

/**
 * Inverse of `mergeMcpServerEntry`: drop `mcpServers.<name>` while leaving
 * other servers and unrelated top-level keys untouched. Returns true when a
 * write happened. No-ops (returns false) when the file or entry is absent.
 */
export const removeMcpServerEntry = async (
  path: string,
  serverName: string
): Promise<boolean> => {
  const current = readJson<{ mcpServers?: Record<string, unknown> }>(path);
  if (!current?.mcpServers || !(serverName in current.mcpServers)) return false;
  const { [serverName]: _dropped, ...rest } = current.mcpServers;
  const next: Record<string, unknown> = { ...current };
  if (Object.keys(rest).length === 0) delete next.mcpServers;
  else next.mcpServers = rest;
  await writeJson(path, next);
  return true;
};
