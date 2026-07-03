import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import writeFileAtomic from 'write-file-atomic';
import type { McpServerEntry } from '../clients/types';

/**
 * Minimal, block-scoped TOML editing for the one thing the CLI needs: adding
 * or removing an `[mcp_servers.<name>]` table in Codex's `config.toml`. We
 * deliberately avoid a full TOML parser/serializer dependency — round-tripping
 * arbitrary TOML while preserving comments and formatting is a large surface,
 * and we only ever own the single `unspa` table. Everything the user wrote
 * elsewhere in the file is passed through byte-for-byte; we only replace (or
 * append/remove) our own table, plus any `[mcp_servers.<name>.*]` sub-tables a
 * hand edit may have introduced under it.
 */

/** The dotted table path we own, e.g. `mcp_servers.unspa`. */
const tablePath = (serverName: string): string => `mcp_servers.${serverName}`;

/**
 * Extract the dotted key of a TOML table header line (`[a.b]` or `[[a.b]]`),
 * or null if the line is not a header. Leading/trailing whitespace tolerated
 * so hand-indented configs still parse for our block boundaries.
 */
const headerKey = (line: string): string | null => {
  const m = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*$/.exec(line);
  return m ? m[1].trim() : null;
};

/** Does this header belong to our table or one of its sub-tables? */
const belongsToBlock = (key: string, name: string): boolean => {
  const path = tablePath(name);
  return key === path || key.startsWith(`${path}.`);
};

/**
 * Serialize a TOML string value. Prefer a literal string (`'...'`) for values
 * containing backslashes — Windows paths like `C:\Users\me` — so they survive
 * verbatim with no escaping, as long as they hold no single quote or newline.
 * Everything else uses a basic string with the standard escapes.
 */
const escapeBasic = (s: string): string =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');

const tomlString = (s: string): string => {
  if (s.includes('\\') && !s.includes("'") && !/[\n\r]/.test(s)) return `'${s}'`;
  return `"${escapeBasic(s)}"`;
};

/**
 * Render the `[mcp_servers.<name>]` block for an MCP entry. `type` (the JSON
 * clients' `"stdio"` discriminator) is intentionally dropped — Codex infers
 * stdio from the presence of `command`. `env` is emitted as an inline table so
 * the whole entry stays inside one header block, which keeps upsert/remove a
 * simple contiguous-region swap.
 */
export const renderTomlServerBlock = (serverName: string, entry: McpServerEntry): string => {
  const lines = [`[${tablePath(serverName)}]`, `command = ${tomlString(entry.command)}`];
  const args = entry.args ?? [];
  lines.push(`args = [${args.map(tomlString).join(', ')}]`);
  const env = entry.env;
  if (env && Object.keys(env).length > 0) {
    const inline = Object.entries(env)
      .map(([k, v]) => `${k} = ${tomlString(v)}`)
      .join(', ');
    lines.push(`env = { ${inline} }`);
  }
  return lines.join('\n');
};

const trimTrailingEmpty = (arr: readonly string[]): string[] => {
  let end = arr.length;
  while (end > 0 && arr[end - 1].trim() === '') end -= 1;
  return arr.slice(0, end);
};

const trimLeadingEmpty = (arr: readonly string[]): string[] => {
  let start = 0;
  while (start < arr.length && arr[start].trim() === '') start += 1;
  return arr.slice(start);
};

/** Locate our block's line span `[start, end)`, or null when absent. */
const findBlock = (lines: readonly string[], name: string): { start: number; end: number } | null => {
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (headerKey(lines[i]) === tablePath(name)) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const key = headerKey(lines[i]);
    if (key && !belongsToBlock(key, name)) {
      end = i;
      break;
    }
  }
  return { start, end };
};

/** Reassemble surrounding regions and the replacement with single blank-line seams. */
const stitch = (before: readonly string[], block: readonly string[], after: readonly string[]): string => {
  const b = trimTrailingEmpty(before);
  const a = trimLeadingEmpty(after);
  const parts: string[] = [];
  if (b.length) parts.push(...b, '');
  parts.push(...block);
  if (a.length) parts.push('', ...a);
  return `${parts.join('\n')}\n`;
};

/**
 * Pure core: upsert `block` as the `[mcp_servers.<name>]` table in `content`,
 * appending it when absent and replacing it (plus any sub-tables) in place when
 * present. Returns the next content and whether it differs from the input.
 */
export const upsertTomlServerBlock = (
  content: string,
  name: string,
  block: string
): { content: string; changed: boolean } => {
  const blockArr = block.split('\n');
  const lines = content.split('\n');
  const span = findBlock(lines, name);
  const next = span
    ? stitch(lines.slice(0, span.start), blockArr, lines.slice(span.end))
    : stitch(lines, blockArr, []);
  return { content: next, changed: next !== content };
};

/** Pure core: drop the `[mcp_servers.<name>]` table (and sub-tables) if present. */
export const removeTomlServerBlock = (
  content: string,
  name: string
): { content: string; changed: boolean } => {
  const lines = content.split('\n');
  const span = findBlock(lines, name);
  if (!span) return { content, changed: false };
  const before = trimTrailingEmpty(lines.slice(0, span.start));
  const after = trimLeadingEmpty(lines.slice(span.end));
  const parts = [...before];
  if (before.length && after.length) parts.push('');
  parts.push(...after);
  const next = parts.length ? `${parts.join('\n')}\n` : '';
  return { content: next, changed: next !== content };
};

const writeText = async (path: string, text: string): Promise<void> => {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  await writeFileAtomic(path, text, 'utf8');
};

/**
 * File-level upsert mirroring `mergeMcpServerEntry` (the JSON sibling): read the
 * config (empty when missing), swap in our block, write only when something
 * changed. Returns true on a real write so the caller logs "wrote" vs
 * "already up to date".
 */
export const mergeTomlServerEntry = async (
  path: string,
  serverName: string,
  entry: McpServerEntry
): Promise<boolean> => {
  const content = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const block = renderTomlServerBlock(serverName, entry);
  const { content: next, changed } = upsertTomlServerBlock(content, serverName, block);
  if (!changed) return false;
  await writeText(path, next);
  return true;
};

/** File-level inverse of {@link mergeTomlServerEntry}. */
export const removeTomlServerEntry = async (path: string, serverName: string): Promise<boolean> => {
  if (!existsSync(path)) return false;
  const content = readFileSync(path, 'utf8');
  const { content: next, changed } = removeTomlServerBlock(content, serverName);
  if (!changed) return false;
  await writeText(path, next);
  return true;
};
