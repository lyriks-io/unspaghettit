import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { BehavioralIndex } from '../repo-link';
import type { RepoContext } from '../server';

/**
 * Where the behavioral index came from for one call.
 *
 * Standalone, the index lives in `.unspa.json` next to the code and the server
 * reads it off disk. Embedded in a host that runs the engine as a subprocess
 * (Lyriks runs it in a container), there IS no checkout to read: the agent holds
 * the filesystem and the server holds the spec. Those callers pass the index
 * inline instead.
 *
 * `repoRoot` is null on the inline path, which the consumers already handle —
 * snippet reads fall back to `noFileFallback()` and line-healing is skipped,
 * because both need the actual files. Everything that only needs the index
 * itself (entry lookup, gap cross-referencing, status reporting) is unaffected.
 */
export type IndexSource = {
  readonly index: BehavioralIndex;
  /** Project the index describes; null when neither the link nor the caller named one. */
  readonly projectId: string | null;
  /** Absolute repo root for snippet reads and line healing; null for an inline index. */
  readonly repoRoot: string | null;
};

/** Zod shape shared by every tool that accepts an inline index. Spread into `inputSchema`. */
export const inlineIndexSchema = {
  index: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Behavioral index to use INSTEAD of reading .unspa.json from disk. Pass this when the server has no access to the checkout (the caller reads and writes .unspa.json itself). Same shape as the `index` object inside .unspa.json.'
    ),
  projectId: z
    .string()
    .optional()
    .describe('Project the inline index belongs to. Required when `index` is passed, ignored otherwise.')
};

/** Discriminates a resolution failure from a resolved source, without throwing. */
export const isIndexSourceError = (
  value: IndexSource | { readonly error: string }
): value is { readonly error: string } => 'error' in value;

/**
 * Resolve the index for one call: the caller's inline payload when present,
 * otherwise the linked `.unspa.json`. Returns `{ error }` rather than throwing
 * so each tool keeps returning its own `errorText` envelope.
 */
export const resolveIndexSource = (
  repoContext: RepoContext | undefined,
  inline?: { readonly index?: Record<string, unknown>; readonly projectId?: string }
): IndexSource | { readonly error: string } => {
  if (inline?.index) {
    if (!inline.projectId) {
      return { error: 'projectId is required when an inline `index` is passed.' };
    }
    return {
      index: inline.index as BehavioralIndex,
      projectId: inline.projectId,
      repoRoot: null
    };
  }

  if (!repoContext?.linkPath) {
    return {
      error:
        'No .unspa.json found. Either bind this folder to a project (`unspa link`), or pass the index inline via `index` + `projectId`.'
    };
  }

  let raw: { projectId?: string; index?: BehavioralIndex };
  try {
    raw = JSON.parse(readFileSync(repoContext.linkPath, 'utf8')) as typeof raw;
  } catch {
    return { error: `Could not read ${repoContext.linkPath}` };
  }

  return {
    index: raw.index ?? {},
    projectId: raw.projectId ?? null,
    repoRoot: dirname(repoContext.linkPath)
  };
};
