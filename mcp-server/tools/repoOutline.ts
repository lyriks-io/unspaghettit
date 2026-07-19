import { existsSync, readdirSync, statSync, type Dirent } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { normalizeRepoPath } from '../../src/features/source-provenance/domain/CodeAdoption';
import { trackTokens } from '../metrics';
import { errorText, text, type ToolDeps } from './_shared';

/**
 * `outline_repo`: a bounded, disk-read sketch of a repo's source tree so an
 * adopting LLM can propose a faithful feature split from real structure
 * instead of guessing folder names. It surfaces structure; it never decides
 * the taxonomy (the caller still names the features and confirms the split).
 *
 * The server does the walk because it already has repo disk access (the same
 * capability behind `attach_source_path`), so this also works on hosts that
 * give the model no filesystem tools of its own.
 */

/**
 * Directory names never worth walking during adoption: dependency trees,
 * build output, and caches. Any directory whose name starts with '.' is
 * skipped too, which covers `.git`, `.svelte-kit`, `.next`, `.turbo`,
 * `.venv`, `.idea`, `.vscode`, and friends without listing each.
 */
export const OUTLINE_IGNORED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  'vendor',
  'tmp',
  'temp',
  '__pycache__',
  'venv'
]);

/** How many file names to keep per directory when `includeFiles` is set. */
const FILE_NAMES_PER_DIR = 12;
/** How many extensions to keep in the file-type histogram. */
const FILE_TYPES_KEPT = 20;

const DEFAULT_DEPTH = 4;
const MAX_DEPTH = 8;
const DEFAULT_MAX_ENTRIES = 400;
const MAX_MAX_ENTRIES = 2000;

export type OutlineDir = {
  /** Repo-relative POSIX path; '.' for the scanned root. */
  readonly path: string;
  /** Regular files directly in this directory (after ignores). */
  readonly files: number;
  /** Immediate kept subdirectories (ignored ones are not counted). */
  readonly dirs: number;
  /** First few file names, present only when `includeFiles` is set. */
  readonly fileNames?: readonly string[];
};

export type RepoOutline = {
  /** Absolute repo root the scan resolved against. */
  readonly root: string;
  /** Repo-relative subtree scanned ('.' = whole repo). */
  readonly scope: string;
  /** Max depth walked below the scope root. */
  readonly depth: number;
  readonly directories: readonly OutlineDir[];
  /** Files counted across the scanned tree (after ignores). */
  readonly totalFiles: number;
  /** Extension -> count, the busiest few, as a language hint. */
  readonly fileTypes: Record<string, number>;
  /** True when the `maxEntries` cap stopped the walk early. */
  readonly truncated: boolean;
  readonly note?: string;
};

export type OutlineOptions = {
  readonly depth?: number;
  readonly maxEntries?: number;
  readonly includeFiles?: boolean;
};

const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, Math.round(n)));

/** Lowercased extension of a file name, or null for dotfiles / no extension. */
const extensionOf = (name: string): string | null => {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null; // '.gitignore' -> null, 'README' -> null
  return name.slice(dot + 1).toLowerCase();
};

/**
 * Walk `scanRoot` breadth-first (so a broad, shallow tree surfaces before a
 * deep corner), skipping ignored and hidden directories and following no
 * symlinks. Pure over the filesystem: give it a real directory, get the
 * outline. Unreadable directories are skipped rather than throwing.
 */
export const buildRepoOutline = (
  scanRoot: string,
  scopeRel: string,
  options: OutlineOptions = {}
): RepoOutline => {
  const depth = clamp(options.depth ?? DEFAULT_DEPTH, 1, MAX_DEPTH);
  const maxEntries = clamp(options.maxEntries ?? DEFAULT_MAX_ENTRIES, 1, MAX_MAX_ENTRIES);
  const includeFiles = options.includeFiles ?? false;

  const directories: OutlineDir[] = [];
  const fileTypes = new Map<string, number>();
  let totalFiles = 0;
  let truncated = false;

  const queue: Array<{ readonly abs: string; readonly rel: string; readonly d: number }> = [
    { abs: scanRoot, rel: '.', d: 0 }
  ];

  while (queue.length > 0) {
    if (directories.length >= maxEntries) {
      truncated = true;
      break;
    }
    const { abs, rel, d } = queue.shift() as { abs: string; rel: string; d: number };

    let entries: Dirent[];
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      continue; // permissions / race: skip this directory rather than fail the whole scan
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    const keptDirs: string[] = [];
    const fileNames: string[] = [];
    let files = 0;

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue; // never follow: cycles and escapes
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || OUTLINE_IGNORED_DIRS.has(entry.name)) continue;
        keptDirs.push(entry.name);
      } else if (entry.isFile()) {
        files += 1;
        totalFiles += 1;
        if (fileNames.length < FILE_NAMES_PER_DIR) fileNames.push(entry.name);
        const ext = extensionOf(entry.name);
        if (ext) fileTypes.set(ext, (fileTypes.get(ext) ?? 0) + 1);
      }
    }

    directories.push({
      path: rel,
      files,
      dirs: keptDirs.length,
      ...(includeFiles && fileNames.length > 0 ? { fileNames } : {})
    });

    if (d < depth) {
      for (const name of keptDirs) {
        queue.push({ abs: join(abs, name), rel: rel === '.' ? name : `${rel}/${name}`, d: d + 1 });
      }
    }
  }

  const topFileTypes = Object.fromEntries(
    [...fileTypes.entries()].sort((a, b) => b[1] - a[1]).slice(0, FILE_TYPES_KEPT)
  );

  return {
    root: scanRoot,
    scope: scopeRel,
    depth,
    directories,
    totalFiles,
    fileTypes: topFileTypes,
    truncated,
    ...(truncated
      ? {
          note: `Stopped at ${maxEntries} directories. Narrow the scan with subPath or a lower depth to see the rest.`
        }
      : {})
  };
};

export const registerRepoOutlineTool = ({ server, repoContext }: ToolDeps): void => {
  server.registerTool(
    'outline_repo',
    {
      description:
        "Codebase-adoption helper: returns a bounded outline of the repo's source tree (directories, a file count per directory, and a file-type histogram) so you can propose a faithful feature split from real structure instead of guessing. The server reads the tree from disk (the same access behind attach_source_path), so this works even when the host gives you no filesystem tools. node_modules, build output, caches, and dot-directories are skipped; the walk is capped by `depth` (default 4) and `maxEntries` (default 400). It surfaces structure only, it does not decide the taxonomy: you still name the features and confirm the split with the user. Scope a monorepo package with `subPath` (e.g. 'packages/api/src'); set includeFiles to also list file names per directory.",
      inputSchema: {
        subPath: z.string().optional(),
        depth: z.number().int().positive().optional(),
        maxEntries: z.number().int().positive().optional(),
        includeFiles: z.boolean().optional()
      }
    },
    async ({ subPath, depth, maxEntries, includeFiles }) => {
      const repoRoot = repoContext?.linkPath ? dirname(repoContext.linkPath) : repoContext?.cwd;
      if (!repoRoot) {
        return errorText(
          'No repo context to resolve the tree against. Link the repo (`unspa link`) or run the server from the repo root.'
        );
      }

      let scanRoot = repoRoot;
      let scopeRel = '.';
      if (subPath !== undefined && subPath.trim().length > 0) {
        const normalized = normalizeRepoPath(subPath);
        if (!normalized.ok) return errorText(normalized.reason);
        scanRoot = resolve(repoRoot, normalized.path);
        scopeRel = normalized.path;
        if (!existsSync(scanRoot)) {
          return errorText(`No directory at ${normalized.path} (resolved against ${repoRoot}).`);
        }
        try {
          if (!statSync(scanRoot).isDirectory()) {
            return errorText(`${normalized.path} is a file, not a directory; pass a directory to outline.`);
          }
        } catch (e) {
          return errorText(`Could not stat ${normalized.path}: ${(e as Error).message}`);
        }
      }

      const outline = buildRepoOutline(scanRoot, scopeRel, {
        ...(depth !== undefined ? { depth } : {}),
        ...(maxEntries !== undefined ? { maxEntries } : {}),
        ...(includeFiles !== undefined ? { includeFiles } : {})
      });
      // Report the repo root, not the resolved scan directory, so the LLM sees
      // where paths are anchored even when it scoped to a subPath.
      return text(trackTokens('outline_repo', { ...outline, root: repoRoot }));
    }
  );
};
