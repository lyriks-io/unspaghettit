/**
 * In-memory registry of the human identities currently connected to the
 * dashboard's WebSocket sync layer. Drives the "AI · John" sub-label on
 * MCP-driven history entries and toasts: when the MCP makes a change,
 * we look up who's currently at the dashboard and attribute the write
 * back to that user, while keeping `author: 'mcp'` so the AI vs human
 * distinction stays intact in the UI.
 *
 * Tracking model:
 *   - Each WebSocket connection registers its non-anonymous author on
 *     open and releases it on close. Anonymous tags (`Anon-XXXX`) are
 *     skipped — attributing an MCP write to "Anon-1234" is noise.
 *   - A small ring of "recently registered" names lets us pick the
 *     "current" user as the most-recently-seen one. For solo dev (the
 *     common case) this is just "you". For multi-user, it's "whoever
 *     refreshed last" — good enough as a heuristic; we'd need an
 *     out-of-band "I'm asking the AI" signal to do better.
 *   - When all WS connections close, the registry empties and MCP
 *     writes go back to plain `AI` with no actingFor.
 *
 * Pinned on globalThis because the WS server, the reload endpoint, and
 * the YDocManager (which logs history) live in different module trees
 * under SSR + vite-plugin + the cli/dashboard-server.ts entry. Without
 * the global symbol they'd each carry their own empty registry.
 */

const KEY = Symbol.for('unspa-sync.identityRegistry');

type Registry = {
  /** Reference-counted name → number of open WS connections holding it. */
  readonly counts: Map<string, number>;
  /** Names in insertion order; reused to pick the most-recently-active. */
  readonly recent: string[];
};

type Globals = { [KEY]?: Registry };

const get = (): Registry => {
  const g = globalThis as unknown as Globals;
  const existing = g[KEY];
  if (existing) return existing;
  const created: Registry = { counts: new Map(), recent: [] };
  g[KEY] = created;
  return created;
};

const isAnonymous = (author: string): boolean => author.startsWith('Anon-');

export const recordIdentity = (author: string): void => {
  if (isAnonymous(author) || author.length === 0) return;
  const reg = get();
  const prev = reg.counts.get(author) ?? 0;
  reg.counts.set(author, prev + 1);
  // Move to the end of `recent` so the "current" lookup picks the
  // freshest connection. Bound the array so it can't grow without limit
  // across very long-running sessions.
  const i = reg.recent.indexOf(author);
  if (i >= 0) reg.recent.splice(i, 1);
  reg.recent.push(author);
  if (reg.recent.length > 32) reg.recent.shift();
};

export const releaseIdentity = (author: string): void => {
  if (isAnonymous(author) || author.length === 0) return;
  const reg = get();
  const prev = reg.counts.get(author) ?? 0;
  if (prev <= 1) {
    reg.counts.delete(author);
    const i = reg.recent.indexOf(author);
    if (i >= 0) reg.recent.splice(i, 1);
    return;
  }
  reg.counts.set(author, prev - 1);
};

/**
 * Best-guess "who's at the dashboard right now". Returns null when no
 * named user is connected (anonymous-only sessions count as null).
 * Walks `recent` from newest to oldest and returns the first entry
 * still in `counts`; the splice in recordIdentity guarantees the tail
 * is the freshest.
 */
export const currentActiveUser = (): string | null => {
  const reg = get();
  for (let i = reg.recent.length - 1; i >= 0; i -= 1) {
    const name = reg.recent[i];
    if (name !== undefined && reg.counts.has(name)) return name;
  }
  return null;
};

/** Test / teardown helper. Not used in production. */
export const resetIdentityRegistry = (): void => {
  const reg = get();
  reg.counts.clear();
  reg.recent.length = 0;
};
