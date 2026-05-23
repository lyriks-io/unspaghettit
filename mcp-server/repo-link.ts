import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, parse, resolve } from 'node:path';

const LINK_FILENAME = '.unspa.json';

export type IndexEntryStatus = 'implemented' | 'partial' | 'missing';

export type IndexEntry = {
  readonly status: IndexEntryStatus;
  /** Relative path from the repo root (or the folder containing .unspa.json). */
  readonly file: string;
  readonly line: number;
  /** The function/class/component signature. One meaningful line that identifies the implementation. */
  readonly signature: string;
  /** ISO timestamp of the last audit pass for this entry. */
  readonly auditedAt?: string;
  /** Git commit SHA of the implementation file when this entry was last audited. */
  readonly gitCommit?: string;
  /** Feature updatedAt (ISO) when this entry was last audited. Detects spec drift. */
  readonly specVersion?: string;
  /**
   * Pattern hint so the LLM knows what to expect before reading the file.
   * Known values: svelte-route | svelte-store | svelte-component | mcp-tool |
   *               mcp-entrypoint | domain-service
   */
  readonly kind?: string;
  /** Additional files involved in this entity's implementation. */
  readonly relatedFiles?: readonly { readonly file: string; readonly line: number; readonly role: string }[];
  /** Path to the test file covering this entity. Run with `vitest run <testFile>`. */
  readonly testFile?: string;
  /** Structured list of spec elements that are not yet implemented. */
  readonly knownGaps?: readonly string[];
  readonly notes?: string;
};

/**
 * Keyed by "<type>:<id-or-path>":
 *   action:<actionId>   surface:<surfaceId>    state:<dotted.path>
 *   rule:<ruleId>               invariant:<id>         event:<eventName>
 *   transition:<transitionId>
 */
export type BehavioralIndex = Record<string, IndexEntry>;

/**
 * Shape of `.unspa.json`. Kept in sync with the CLI's writer
 * (cli/util/link.ts). Mirrored here rather than imported to keep the MCP
 * server's deps independent of the CLI bundle.
 *
 * Bound to a **project**, not a feature: a repo is one codebase, which holds
 * one or more features. The LLM picks the right feature from the project's
 * member list based on context (file paths being edited, action being
 * implemented, the user prompt).
 */
export type RepoLink = {
  readonly projectId: string;
  readonly projectName?: string;
  readonly index?: BehavioralIndex;
  /**
   * When set, write tools that mutate the spec (apply_batch and generate_types
   * itself) regenerate the TypeScript types module here on success. Path is
   * resolved relative to the directory containing this `.unspa.json`.
   * Populated automatically on the first generate_types call so subsequent
   * spec edits don't drift away from the codegen output.
   */
  readonly generatedTypesPath?: string;
};

export type RepoLinkLookup = {
  readonly link: RepoLink | null;
  readonly path: string | null;
  readonly cwd: string;
};

const readLinkFile = (candidate: string): RepoLink | null => {
  try {
    const raw = JSON.parse(readFileSync(candidate, 'utf8')) as RepoLink;
    if (raw && typeof raw.projectId === 'string' && raw.projectId.length > 0) {
      return raw;
    }
  } catch {
    // Malformed file. Treat as if no link existed rather than crash.
  }
  return null;
};

/**
 * Walk up from `cwd` looking for the first `.unspa.json`. Returns the link
 * + the file path it was found at, or null link when no file exists in any
 * ancestor. Mirrors the discovery semantics of `discoverSnapshotDirectory`
 * so a repo is detected the same way regardless of which sub-dir the MCP
 * server was started from.
 *
 * When `explicitPath` is provided (via --link flag or UNSPA_LINK env var),
 * discovery is skipped and that file is used directly. The path may point
 * at a `.unspa.json` file or a directory containing one.
 */
export const discoverRepoLink = (
  cwd: string = process.cwd(),
  explicitPath?: string
): RepoLinkLookup => {
  if (explicitPath) {
    const resolved = resolve(cwd, explicitPath);
    const candidate = resolved.endsWith(LINK_FILENAME) ? resolved : join(resolved, LINK_FILENAME);
    if (!existsSync(candidate)) {
      throw new Error(`No .unspa.json found at ${candidate}`);
    }
    const link = readLinkFile(candidate);
    if (!link) throw new Error(`Malformed .unspa.json at ${candidate}`);
    return { link, path: candidate, cwd };
  }

  let current = resolve(cwd);
  const { root } = parse(current);
  while (true) {
    const candidate = join(current, LINK_FILENAME);
    if (existsSync(candidate)) {
      const link = readLinkFile(candidate);
      if (link) return { link, path: candidate, cwd };
    }
    if (current === root) break;
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return { link: null, path: null, cwd };
};

/**
 * Write an updated RepoLink back to the given path, preserving field order
 * and pretty-printing so the file remains human-readable.
 */
export const writeRepoLink = (filePath: string, link: RepoLink): void => {
  writeFileSync(filePath, JSON.stringify(link, null, 2) + '\n', 'utf8');
};
