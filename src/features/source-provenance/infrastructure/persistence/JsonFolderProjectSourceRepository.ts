import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import writeFileAtomic from 'write-file-atomic';
import type { ProjectSource } from '$features/source-provenance/domain/ProjectSource';
import type { ProjectSourceRepository } from '$features/source-provenance/application/ports/ProjectSourceRepository';
import {
  exportSourceToJson,
  importSourceFromJson
} from '$features/source-provenance/infrastructure/io/SourceJson';
import {
  SOURCE_SUFFIX,
  ensureSourcesDir,
  findProjectSlugById,
  sourceFilePath,
  walkSources
} from '$shared/infrastructure/persistence/snapshotLayout';

/**
 * Source document persistence. `sources/<sourceId>.source.json` lives inside
 * the owning project's folder (or `__unassigned/sources/` when no project
 * claims the analysis), so the document sits right next to the feature files
 * it feeds and travels with the project folder. Keyed on the stable opaque
 * source id; the human name lives inside the file so renaming a source never
 * moves it on disk.
 */
export class JsonFolderProjectSourceRepository implements ProjectSourceRepository {
  constructor(private readonly directory: string) {}

  async listForProject(projectId: string | null): Promise<readonly ProjectSource[]> {
    const out: ProjectSource[] = [];
    for (const { path } of walkSources(this.directory)) {
      const source = this.read(path);
      if (source && source.projectId === projectId) out.push(source);
    }
    return out.sort((a, b) => b.attachedAt.localeCompare(a.attachedAt));
  }

  async find(sourceId: string): Promise<ProjectSource | null> {
    for (const { file, path } of walkSources(this.directory)) {
      if (file === `${sourceId}${SOURCE_SUFFIX}`) return this.read(path);
    }
    return null;
  }

  async save(source: ProjectSource): Promise<void> {
    const slug =
      source.projectId === null ? null : findProjectSlugById(this.directory, source.projectId);
    ensureSourcesDir(this.directory, slug);
    const destination = sourceFilePath(this.directory, slug, source.id);

    // Sweep up an old copy if the owning project moved/renamed since the last
    // save, so the same sourceId never ends up duplicated across folders.
    for (const { file, path } of walkSources(this.directory)) {
      if (file === `${source.id}${SOURCE_SUFFIX}` && path !== destination) unlinkSync(path);
    }

    await writeFileAtomic(destination, exportSourceToJson(source), 'utf8');
  }

  async delete(sourceId: string): Promise<void> {
    for (const { file, path } of walkSources(this.directory)) {
      if (file === `${sourceId}${SOURCE_SUFFIX}` && existsSync(path)) unlinkSync(path);
    }
  }

  private read(path: string): ProjectSource | null {
    try {
      return importSourceFromJson(readFileSync(path, 'utf8'));
    } catch {
      return null;
    }
  }
}
