import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync
} from 'node:fs';
import { join } from 'node:path';

/**
 * On-disk layout for the `unspa/` (or `lyriks/`) snapshot directory.
 *
 * Single source of truth for both the static JSON repositories
 * (mcp-server + container) and the Yjs sync path (snapshotIo + historyStore).
 * Both must produce the same filenames so they can read each other's files.
 *
 * Layout:
 *
 *   <root>/
 *     <projectSlug>/
 *       <projectSlug>.project.json
 *       <featureSlug>.feature.json
 *       <featureId>.implementation-status.json
 *       history/
 *         <projectSlug>.project.history.json
 *         <featureSlug>.feature.history.json
 *         <featureId>.implementation-status.history.json
 *     __unassigned/
 *       <featureSlug>.feature.json
 *       <featureId>.implementation-status.json
 *       history/
 *         ...
 *     <domainSlug>.domain.json       (Domains span projects — stay flat.)
 *
 * Orphan features (not linked to any project) live under `__unassigned/`.
 * Domains intentionally stay at the root because they cross-cut projects.
 *
 * The `history/` subfolder keeps the spec snapshots (the source-of-truth
 * JSON the user reads/edits) visually separated from the time-travel log
 * (which is a generated/derived artifact). Legacy installs that still
 * have history files at the project-folder root are auto-migrated on
 * startup by `migrateFlatLayout`.
 */

export const PROJECT_SUFFIX = '.project.json';
export const FEATURE_SUFFIX = '.feature.json';
export const STATUS_SUFFIX = '.implementation-status.json';
export const PROVENANCE_SUFFIX = '.provenance.json';
export const DOMAIN_SUFFIX = '.domain.json';
export const HISTORY_SUFFIX = '.history.json';
export const UNASSIGNED_FOLDER = '__unassigned';
export const HISTORY_SUBFOLDER = 'history';

const ensureDir = (path: string): void => {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
};

/** Folder name for a project (its slug) or the orphan bucket for null. */
export const projectFolder = (projectSlug: string | null): string =>
  projectSlug ?? UNASSIGNED_FOLDER;

export const projectDir = (root: string, projectSlug: string | null): string =>
  join(root, projectFolder(projectSlug));

export const projectFilePath = (root: string, slug: string): string =>
  join(projectDir(root, slug), `${slug}${PROJECT_SUFFIX}`);

export const featureFilePath = (
  root: string,
  projectSlug: string | null,
  featureSlug: string
): string => join(projectDir(root, projectSlug), `${featureSlug}${FEATURE_SUFFIX}`);

export const statusFilePath = (
  root: string,
  projectSlug: string | null,
  featureId: string
): string => join(projectDir(root, projectSlug), `${featureId}${STATUS_SUFFIX}`);

/**
 * Provenance sidecar path. Like the implementation-status sidecar it keys on
 * the stable featureId (not the human slug) so renames don't orphan it, and it
 * lives next to its feature in the owning project folder.
 */
export const provenanceFilePath = (
  root: string,
  projectSlug: string | null,
  featureId: string
): string => join(projectDir(root, projectSlug), `${featureId}${PROVENANCE_SUFFIX}`);

export type HistoryKind = 'feature' | 'project' | 'implementation-status';

export const historySuffix = (kind: HistoryKind): string =>
  `.${kind}${HISTORY_SUFFIX}`;

/** Directory that holds the time-travel logs for one project / __unassigned. */
export const historyDir = (root: string, projectSlug: string | null): string =>
  join(projectDir(root, projectSlug), HISTORY_SUBFOLDER);

export const historyFilePath = (
  root: string,
  projectSlug: string | null,
  kind: HistoryKind,
  slugOrId: string
): string => join(historyDir(root, projectSlug), `${slugOrId}${historySuffix(kind)}`);

/** Ensure the project folder exists before a write. */
export const ensureProjectDir = (root: string, projectSlug: string | null): string => {
  const dir = projectDir(root, projectSlug);
  ensureDir(dir);
  return dir;
};

/** Ensure the project folder's history/ subdir exists before a history write. */
export const ensureHistoryDir = (root: string, projectSlug: string | null): string => {
  ensureProjectDir(root, projectSlug);
  const dir = historyDir(root, projectSlug);
  ensureDir(dir);
  return dir;
};

/** List every project subfolder under root. Domains and __unassigned are excluded. */
export const listProjectFolders = (root: string): readonly string[] => {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== UNASSIGNED_FOLDER && !name.startsWith('.'));
};

/** All folders that may contain feature/status/history files (projects + unassigned). */
export const listAllSnapshotFolders = (root: string): readonly string[] => {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name);
};

export type Walked = { readonly folder: string; readonly file: string; readonly path: string };

/** Walk every file matching `suffix` across all snapshot folders.
 *
 *  For history suffixes we ALSO scan the per-folder `history/` subdir
 *  (the canonical location since the layout split). Legacy installs
 *  may still have history files at the project-folder root — those are
 *  walked too, and `migrateFlatLayout` will move them on next startup.
 */
export const walkBySuffix = (root: string, suffix: string): readonly Walked[] => {
  const out: Walked[] = [];
  const isHistory = suffix.endsWith(HISTORY_SUFFIX);
  for (const folder of listAllSnapshotFolders(root)) {
    const dir = join(root, folder);
    for (const file of readdirSync(dir)) {
      if (file.endsWith(suffix)) {
        out.push({ folder, file, path: join(dir, file) });
      }
    }
    if (isHistory) {
      const subdir = join(dir, HISTORY_SUBFOLDER);
      if (existsSync(subdir)) {
        for (const file of readdirSync(subdir)) {
          if (file.endsWith(suffix)) {
            out.push({ folder, file, path: join(subdir, file) });
          }
        }
      }
    }
  }
  return out;
};

/**
 * Find the project folder slug that owns a given featureId by scanning every
 * `*.project.json` in the tree and inspecting its `featureIds[]`. Returns
 * `null` if no project claims this feature (caller writes to __unassigned).
 *
 * This reads from disk — caller should call it on writes, not on every read.
 * Cached lookups would invalidate the moment another process moves files.
 */
export const findProjectSlugForFeature = (
  root: string,
  featureId: string
): string | null => {
  for (const { folder, path } of walkBySuffix(root, PROJECT_SUFFIX)) {
    try {
      const raw = readFileSync(path, 'utf8');
      const data = JSON.parse(raw) as {
        project?: { featureIds?: readonly string[] };
        featureIds?: readonly string[];
      };
      const featureIds = data.project?.featureIds ?? data.featureIds ?? [];
      if (featureIds.includes(featureId)) return folder;
    } catch {
      // Malformed project file — skip; the next read or the validator surfaces it.
    }
  }
  return null;
};

/**
 * Detects whether the directory still has the flat (legacy) layout, i.e. any
 * `*.project.json` / `*.feature.json` / `*.implementation-status.json` lives
 * at the root instead of inside a project folder. Cheap; used as a gate for
 * `migrateFlatLayout()` so we don't rescan on every startup.
 */
export const hasFlatLayout = (root: string): boolean => {
  if (!existsSync(root)) return false;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (
      entry.name.endsWith(PROJECT_SUFFIX) ||
      entry.name.endsWith(FEATURE_SUFFIX) ||
      entry.name.endsWith(STATUS_SUFFIX) ||
      entry.name.endsWith('.feature' + HISTORY_SUFFIX) ||
      entry.name.endsWith('.project' + HISTORY_SUFFIX)
    ) {
      return true;
    }
  }
  return false;
};

/**
 * One-shot, idempotent migration from the legacy flat layout to per-project
 * subfolders. Safe to call on a directory that's already nested.
 *
 * Strategy:
 *   1. Read every flat project file → move it into `<projectSlug>/`. Capture
 *      a `featureId → projectSlug` map from each project's featureIds[].
 *   2. Move every flat feature file into its owning project folder, or into
 *      `__unassigned/` if no project claims it.
 *   3. Move every flat implementation-status file (filename is `<featureId>.…`)
 *      into the same folder as its feature.
 *   4. Move every flat history file alongside its parent (matched by id).
 *
 * Returns a small report so the caller can log what moved. Domains stay flat.
 */
export type MigrationReport = {
  readonly movedProjects: number;
  readonly movedFeatures: number;
  readonly movedStatus: number;
  readonly movedHistory: number;
};

export const migrateFlatLayout = (root: string): MigrationReport => {
  const report = { movedProjects: 0, movedFeatures: 0, movedStatus: 0, movedHistory: 0 };
  // History-into-subfolder migration runs independently: legacy installs may
  // already be on the per-project layout but still have history files at the
  // project-folder root from before the split.
  report.movedHistory += migrateHistoryIntoSubfolders(root);
  if (!hasFlatLayout(root)) return report;

  const ownerByFeatureId = new Map<string, string>();
  const slugByFeatureId = new Map<string, string>();
  const slugByProjectId = new Map<string, string>();

  // Pass 1: project files. Move into <slug>/<slug>.project.json and remember
  // the feature ids each project claims.
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(PROJECT_SUFFIX)) continue;
    const slug = entry.name.slice(0, -PROJECT_SUFFIX.length);
    const srcPath = join(root, entry.name);
    let project: { id?: string; featureIds?: readonly string[] } = {};
    try {
      const raw = readFileSync(srcPath, 'utf8');
      const parsed = JSON.parse(raw) as {
        project?: { id?: string; featureIds?: readonly string[] };
        id?: string;
        featureIds?: readonly string[];
      };
      project = parsed.project ?? (parsed as typeof project);
    } catch {
      // Leave malformed file in place; the validator will surface it later.
      continue;
    }
    ensureProjectDir(root, slug);
    const destPath = projectFilePath(root, slug);
    renameSync(srcPath, destPath);
    report.movedProjects += 1;
    if (project.id) slugByProjectId.set(project.id, slug);
    for (const fid of project.featureIds ?? []) {
      ownerByFeatureId.set(fid, slug);
    }
  }

  // Pass 2: feature files. Move into the owning project folder, or __unassigned/.
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(FEATURE_SUFFIX)) continue;
    if (entry.name.endsWith(HISTORY_SUFFIX)) continue;
    const featureSlug = entry.name.slice(0, -FEATURE_SUFFIX.length);
    const srcPath = join(root, entry.name);
    let featureId: string | undefined;
    try {
      const raw = readFileSync(srcPath, 'utf8');
      const parsed = JSON.parse(raw) as {
        feature?: { id?: string };
        id?: string;
      };
      featureId = parsed.feature?.id ?? parsed.id;
    } catch {
      continue;
    }
    const owner = featureId ? ownerByFeatureId.get(featureId) ?? null : null;
    ensureProjectDir(root, owner);
    const destPath = featureFilePath(root, owner, featureSlug);
    renameSync(srcPath, destPath);
    report.movedFeatures += 1;
    if (featureId) slugByFeatureId.set(featureId, featureSlug);
  }

  // Pass 3: implementation-status files. Filename is `<featureId>.implementation-status.json`.
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(STATUS_SUFFIX)) continue;
    if (entry.name.endsWith(HISTORY_SUFFIX)) continue;
    const featureId = entry.name.slice(0, -STATUS_SUFFIX.length);
    const owner = ownerByFeatureId.get(featureId) ?? null;
    ensureProjectDir(root, owner);
    const srcPath = join(root, entry.name);
    const destPath = statusFilePath(root, owner, featureId);
    renameSync(srcPath, destPath);
    report.movedStatus += 1;
  }

  // Pass 4: history files. Match by parent kind + id-inside-file.
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(HISTORY_SUFFIX)) continue;
    const srcPath = join(root, entry.name);
    let id: string | undefined;
    try {
      const raw = readFileSync(srcPath, 'utf8');
      const parsed = JSON.parse(raw) as { id?: string };
      id = parsed.id;
    } catch {
      continue;
    }
    if (!id) continue;
    let owner: string | null = null;
    if (entry.name.endsWith('.project' + HISTORY_SUFFIX)) {
      // Live project: history goes in the project's own folder's history/.
      // Orphan project (no matching project file exists): drop into
      // __unassigned/history/ so nothing ends up loose at root.
      owner = slugByProjectId.get(id) ?? null;
      ensureHistoryDir(root, owner);
      const destPath = join(historyDir(root, owner), entry.name);
      renameSync(srcPath, destPath);
      report.movedHistory += 1;
    } else if (entry.name.endsWith('.feature' + HISTORY_SUFFIX)) {
      owner = ownerByFeatureId.get(id) ?? null;
      ensureHistoryDir(root, owner);
      const destPath = join(historyDir(root, owner), entry.name);
      renameSync(srcPath, destPath);
      report.movedHistory += 1;
    } else if (entry.name.endsWith('.implementation-status' + HISTORY_SUFFIX)) {
      owner = ownerByFeatureId.get(id) ?? null;
      ensureHistoryDir(root, owner);
      const destPath = join(historyDir(root, owner), entry.name);
      renameSync(srcPath, destPath);
      report.movedHistory += 1;
    }
  }

  return report;
};

/**
 * Second-pass migration: walk every project folder (including __unassigned)
 * and move any history file sitting directly under it into the new
 * `history/` subdir. Idempotent — re-running on an already-migrated tree is
 * a no-op. Returns the number of files moved.
 */
const migrateHistoryIntoSubfolders = (root: string): number => {
  if (!existsSync(root)) return 0;
  let moved = 0;
  for (const folder of listAllSnapshotFolders(root)) {
    const dir = join(root, folder);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(HISTORY_SUFFIX)) continue;
      const srcPath = join(dir, file);
      const destPath = join(historyDir(root, folder), file);
      if (existsSync(destPath)) continue;
      ensureHistoryDir(root, folder);
      try {
        renameSync(srcPath, destPath);
        moved += 1;
      } catch {
        // Permissions or in-use file — leave it; next startup retries.
      }
    }
  }
  return moved;
};

/**
 * Migrate idempotently and log a single-line summary to stderr. Returns true
 * when something was actually moved. Wraps `migrateFlatLayout` so the wiring
 * code stays one call.
 */
export const migrateFlatLayoutAndLog = (root: string, label: string): boolean => {
  const report = migrateFlatLayout(root);
  const total =
    report.movedProjects + report.movedFeatures + report.movedStatus + report.movedHistory;
  if (total === 0) return false;
  process.stderr.write(
    `[${label}] migrated flat snapshot layout → per-project folders: ` +
      `${report.movedProjects} projects, ${report.movedFeatures} features, ` +
      `${report.movedStatus} status, ${report.movedHistory} history\n`
  );
  return true;
};

/**
 * Used to clean up an empty project folder when its project file gets deleted
 * and no features remain. Best-effort: an EEXIST/EBUSY means another writer
 * already raced us; safe to ignore.
 */
export const removeEmptyProjectFolder = (
  root: string,
  projectSlug: string | null
): void => {
  const dir = projectDir(root, projectSlug);
  if (!existsSync(dir)) return;
  try {
    if (readdirSync(dir).length === 0) rmdirSync(dir);
  } catch {
    // Folder still in use or already gone — fine either way.
  }
};
