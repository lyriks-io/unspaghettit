import { existsSync, readFileSync, unlinkSync } from 'node:fs';
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
  walkBySuffix
} from '$shared/infrastructure/persistence/snapshotLayout';

type LoadedProject = { readonly slug: string; readonly project: Project };

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
  constructor(private readonly directory: string) {}

  async list(): Promise<readonly ProjectSummary[]> {
    return this.readAll()
      .map((s) => s.project)
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
      .map(toSummary);
  }

  async get(id: ProjectId): Promise<Project | null> {
    const found = this.readAll().find((s) => s.project.id === id);
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
    const target = slugify(project.name);
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
    for (const { folder, path } of walkBySuffix(this.directory, PROJECT_SUFFIX)) {
      try {
        const project = importProjectFromJson(readFileSync(path, 'utf8'));
        // Folder name is the canonical slug; trust it so a rename-without-rewrite still resolves.
        out.push({ slug: folder, project });
      } catch {
        // Malformed files skipped so one bad file can't kill the API.
      }
    }
    return out;
  }
}
