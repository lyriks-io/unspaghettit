import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import writeFileAtomic from 'write-file-atomic';
import type {
  ProjectRepository,
  ProjectSummary
} from '$features/projects/application/ports/ProjectRepository';
import type { Project } from '$features/projects/domain/entities/Project';
import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import { normalizeTags } from '$shared/domain/Tags';
import {
  exportProjectToJson,
  importProjectFromJson
} from '$features/projects/infrastructure/io/ProjectJson';
import {
  PROJECT_SUFFIX,
  ensureProjectDir,
  projectFilePath,
  removeEmptyProjectFolder,
  walkBySuffix,
  type FileNaming
} from '$shared/infrastructure/persistence/snapshotLayout';

type LoadedProject = { readonly slug: string; readonly project: Project };

/** A parsed file, valid while its inode, size and mtime all hold. */
type CachedProject = {
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly loaded: LoadedProject;
};

export type JsonFolderProjectRepositoryOptions = {
  /** See {@link FileNaming}. Defaults to `slug`. */
  readonly fileNaming?: FileNaming;
};

const toSummary = (p: Project): ProjectSummary => ({
  id: p.id,
  name: p.name,
  description: p.description,
  tags: normalizeTags(p.tags, { type: p.customTagType, value: p.customTag }),
  featureCount: p.featureIds.length,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt
});

const slugify = (name: string): string => {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base.length > 0 ? base : 'project';
};

export class JsonFolderProjectRepository implements ProjectRepository {
  readonly #fileNaming: FileNaming;
  /** Parsed files by path, re-parsed only when (inode, size, mtime) moved. */
  readonly #parsed = new Map<string, CachedProject>();
  #parses = 0;

  constructor(
    private readonly directory: string,
    options: JsonFolderProjectRepositoryOptions = {}
  ) {
    this.#fileNaming = options.fileNaming ?? 'slug';
  }

  /** Files parsed since construction. A diagnostic, for tests and doctor tooling. */
  get parseCount(): number {
    return this.#parses;
  }

  async list(): Promise<readonly ProjectSummary[]> {
    return this.readAll()
      .map((s) => s.project)
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
      .map(toSummary);
  }

  async get(id: ProjectId): Promise<Project | null> {
    const all = this.readAll();
    const found =
      all.find((s) => s.project.id === id) ??
      // Folder name is the canonical slug (see readAll). A host mirroring
      // snapshots into <key>/<key>.project.json may stamp a different id
      // inside the file; a deep link carrying the folder key still deserves
      // to land on the project. Content id stays the primary key.
      all.find((s) => s.slug === id);
    return found ? found.project : null;
  }

  /**
   * Server-only bulk read: every full Project in ONE directory pass. Not on the
   * {@link ProjectRepository} port — used by derived artifacts (the
   * global-search index) so they avoid an O(N²) `get()`-per-id scan.
   */
  async listFull(): Promise<readonly Project[]> {
    return this.readAll().map((s) => s.project);
  }

  async save(project: Project): Promise<void> {
    const all = this.readAll();
    const previous = all.find((s) => s.project.id === project.id);
    const taken = all
      .filter((s) => s.project.id !== project.id)
      .map((s) => s.slug);
    const target = this.#fileNaming === 'id' ? String(project.id) : slugify(project.name);
    const finalSlug = taken.includes(target)
      ? `${target}-${project.id.slice(0, 8)}`
      : target;

    if (previous && previous.slug !== finalSlug) {
      // Rename moves the whole project folder by writing the new file and
      // unlinking the old. Features inside the old folder must be migrated
      // by their own repository (FeatureRepository.save re-resolves owner).
      const oldPath = projectFilePath(this.directory, previous.slug);
      if (existsSync(oldPath)) unlinkSync(oldPath);
    }

    ensureProjectDir(this.directory, finalSlug);
    await writeFileAtomic(
      projectFilePath(this.directory, finalSlug),
      exportProjectToJson(project),
      'utf8'
    );
  }

  async delete(id: ProjectId): Promise<void> {
    const found = this.readAll().find((s) => s.project.id === id);
    if (!found) return;
    const path = projectFilePath(this.directory, found.slug);
    if (existsSync(path)) unlinkSync(path);
    removeEmptyProjectFolder(this.directory, found.slug);
  }

  private readAll(): readonly LoadedProject[] {
    const out: LoadedProject[] = [];
    const seen = new Set<string>();
    for (const { folder, path } of walkBySuffix(this.directory, PROJECT_SUFFIX)) {
      seen.add(path);
      // Stat before read, so a rewrite between the two is re-parsed next pass.
      let stats: { ino: number; size: number; mtimeMs: number };
      try {
        stats = statSync(path);
      } catch {
        continue;
      }
      const hit = this.#parsed.get(path);
      if (
        hit &&
        hit.ino === stats.ino &&
        hit.size === stats.size &&
        hit.mtimeMs === stats.mtimeMs
      ) {
        out.push(hit.loaded);
        continue;
      }
      try {
        const project = importProjectFromJson(readFileSync(path, 'utf8'));
        this.#parses += 1;
        // Folder name is the canonical slug; trust it so a rename-without-rewrite still resolves.
        const loaded: LoadedProject = { slug: folder, project };
        this.#parsed.set(path, {
          ino: stats.ino,
          size: stats.size,
          mtimeMs: stats.mtimeMs,
          loaded
        });
        out.push(loaded);
      } catch {
        this.#parsed.delete(path);
        // Malformed files skipped so one bad file can't kill the API.
      }
    }
    for (const path of this.#parsed.keys()) if (!seen.has(path)) this.#parsed.delete(path);
    return out;
  }
}
