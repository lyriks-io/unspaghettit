import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import writeFileAtomic from 'write-file-atomic';
import type {
  FeatureRepository,
  FeatureSummary
} from '$features/behavior-model/application/ports/FeatureRepository';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import { summarizeFeature as toSummary } from '$features/behavior-model/domain/services/featureSummary';
import {
  exportFeatureToJson,
  importFeatureFromJson
} from '$features/behavior-model/infrastructure/io/FeatureJson';
import {
  FEATURE_SUFFIX,
  UNASSIGNED_FOLDER,
  ensureProjectDir,
  featureFilePath,
  findProjectSlugForFeature,
  walkBySuffix,
  type FileNaming
} from '$shared/infrastructure/persistence/snapshotLayout';

// Folder name -> project slug | null (null = orphan / __unassigned/).
const folderToSlug = (folder: string): string | null =>
  folder === UNASSIGNED_FOLDER ? null : folder;

type LoadedSnapshot = {
  readonly folder: string;
  readonly slug: string;
  readonly feature: Feature;
};

/** A parsed file, valid while its inode, size and mtime all hold. */
type CachedSnapshot = {
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly snapshot: LoadedSnapshot;
};

export type JsonFolderRepositoryOptions = {
  /** See {@link FileNaming}. Defaults to `slug`. */
  readonly fileNaming?: FileNaming;
};

const slugify = (name: string): string => {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base.length > 0 ? base : 'feature';
};

export class JsonFolderFeatureRepository implements FeatureRepository {
  readonly #fileNaming: FileNaming;
  /**
   * Every file parsed so far, keyed by path. `readAll` still lists the folders
   * and stats every file on each call (that is what keeps another process's
   * writes visible), but only re-parses a file whose (inode, size, mtime)
   * moved. On a workspace of a few hundred features that turns each `get()`
   * from tens of milliseconds of JSON parsing into a handful of stats.
   *
   * Cached features are shared between callers. `Feature` is a readonly type
   * and every use case derives a new object, so that sharing is safe.
   */
  readonly #parsed = new Map<string, CachedSnapshot>();
  #parses = 0;

  constructor(
    private readonly directory: string,
    options: JsonFolderRepositoryOptions = {}
  ) {
    this.#fileNaming = options.fileNaming ?? 'slug';
  }

  /** Files parsed since construction. A diagnostic, for tests and doctor tooling. */
  get parseCount(): number {
    return this.#parses;
  }

  async list(): Promise<readonly FeatureSummary[]> {
    return this.readAll()
      .map((s) => s.feature)
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
      .map(toSummary);
  }

  async get(id: FeatureId): Promise<Feature | null> {
    const found = this.readAll().find((s) => s.feature.id === id);
    return found ? found.feature : null;
  }

  /**
   * Server-only bulk read: every full Feature in ONE directory pass. Not on the
   * {@link FeatureRepository} port — it exists so derived artifacts (notably the
   * global-search index) can build in O(N) instead of the O(N²) that
   * `list()` + a `get()` per id incurs (each `get` re-walks the whole folder).
   */
  async listFull(): Promise<readonly Feature[]> {
    return this.readAll().map((s) => s.feature);
  }

  async save(feature: Feature): Promise<void> {
    // Re-resolve the owning project on every save: when a feature is reassigned
    // (add_feature_to_project / remove_feature_from_project), the very next
    // save needs to land in the new folder. Cheap — one O(projects) scan.
    const ownerSlug = findProjectSlugForFeature(this.directory, String(feature.id));
    const ownerFolder = ownerSlug ?? UNASSIGNED_FOLDER;
    ensureProjectDir(this.directory, ownerSlug);

    const all = this.readAll();
    const previous = all.find((s) => s.feature.id === feature.id);
    const taken = all
      .filter((s) => s.folder === ownerFolder && s.feature.id !== feature.id)
      .map((s) => s.slug);
    const target = this.#fileNaming === 'id' ? String(feature.id) : slugify(feature.name);
    const finalSlug = taken.includes(target)
      ? `${target}-${feature.id.slice(0, 8)}`
      : target;

    if (previous && (previous.folder !== ownerFolder || previous.slug !== finalSlug)) {
      const oldPath = featureFilePath(
        this.directory,
        folderToSlug(previous.folder),
        previous.slug
      );
      if (existsSync(oldPath)) unlinkSync(oldPath);
    }

    await writeFileAtomic(
      featureFilePath(this.directory, ownerSlug, finalSlug),
      exportFeatureToJson(feature),
      'utf8'
    );
  }

  async delete(id: FeatureId): Promise<void> {
    const found = this.readAll().find((s) => s.feature.id === id);
    if (!found) return;
    const path = featureFilePath(this.directory, folderToSlug(found.folder), found.slug);
    if (existsSync(path)) unlinkSync(path);
  }

  private readAll(): readonly LoadedSnapshot[] {
    const out: LoadedSnapshot[] = [];
    const seen = new Set<string>();
    for (const { folder, file, path } of walkBySuffix(this.directory, FEATURE_SUFFIX)) {
      seen.add(path);
      // Stat BEFORE read: a rewrite landing between the two then shows up as a
      // mismatch on the next pass and is parsed again. The other order could
      // pin a fresh stat on stale content until the file changes once more.
      let stats: { ino: number; size: number; mtimeMs: number };
      try {
        stats = statSync(path);
      } catch {
        continue; // vanished between the listing and the stat
      }
      const hit = this.#parsed.get(path);
      if (
        hit &&
        hit.ino === stats.ino &&
        hit.size === stats.size &&
        hit.mtimeMs === stats.mtimeMs
      ) {
        out.push(hit.snapshot);
        continue;
      }
      try {
        const feature = importFeatureFromJson(readFileSync(path, 'utf8'));
        this.#parses += 1;
        const snapshot: LoadedSnapshot = {
          folder,
          slug: file.slice(0, -FEATURE_SUFFIX.length),
          feature
        };
        this.#parsed.set(path, {
          ino: stats.ino,
          size: stats.size,
          mtimeMs: stats.mtimeMs,
          snapshot
        });
        out.push(snapshot);
      } catch (error) {
        this.#parsed.delete(path);
        // Malformed snapshots are skipped so one bad file can't kill the MCP.
        // Warn to stderr (stdout is the JSON-RPC channel and must stay clean)
        // so the drop is diagnosable: a silently-skipped file reads as data
        // loss to authors, the feature just vanishes from list_features /
        // get_feature with no trace. A future doctor tool will surface these.
        console.warn(
          `[unspa] skipped unreadable feature snapshot ${path}: ${(error as Error).message}`
        );
      }
    }
    for (const path of this.#parsed.keys()) if (!seen.has(path)) this.#parsed.delete(path);
    return out;
  }
}
