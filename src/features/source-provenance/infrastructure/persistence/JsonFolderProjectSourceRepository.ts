import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import writeFileAtomic from 'write-file-atomic';
import { join, resolve } from 'node:path';
import type { ProjectSource } from '$features/source-provenance/domain/ProjectSource';
import type { ProjectSourceRepository } from '$features/source-provenance/application/ports/ProjectSourceRepository';
import {
  exportSourceToJson,
  importSourceFromJson
} from '$features/source-provenance/infrastructure/io/SourceJson';
import {
  SOURCE_SUFFIX,
  SOURCES_SUBFOLDER,
  ensureSourcesDir,
  findProjectSlugById,
  isSafeSegment,
  listAllSnapshotFolders,
  sourceFilePath,
  walkSources
} from '$shared/infrastructure/persistence/snapshotLayout';

/** A source may move folders; serialize by identity rather than destination. */
const sourceWrites = new Map<string, Promise<void>>();

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
    if (!isSafeSegment(sourceId)) return null;
    // The stable id already names the file. Do not enumerate every source in
    // every project merely to find one filename; keep lookups fresh after moves.
    for (const folder of listAllSnapshotFolders(this.directory)) {
      const path = join(this.directory, folder, SOURCES_SUBFOLDER, `${sourceId}${SOURCE_SUFFIX}`);
      if (existsSync(path)) return this.read(path);
    }
    return null;
  }

  save(source: ProjectSource): Promise<void> {
    return this.inSourceTurn(source.id, () => this.saveNow(source));
  }

  private inSourceTurn(sourceId: string, write: () => Promise<void>): Promise<void> {
    const key = `${resolve(this.directory)}\0${sourceId}`;
    const previous = sourceWrites.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(write);
    sourceWrites.set(key, next);
    const clear = () => {
      if (sourceWrites.get(key) === next) sourceWrites.delete(key);
    };
    void next.then(clear, clear);
    return next;
  }

  private async saveNow(source: ProjectSource): Promise<void> {
    const slug =
      source.projectId === null ? null : findProjectSlugById(this.directory, source.projectId);
    ensureSourcesDir(this.directory, slug);
    const destination = sourceFilePath(this.directory, slug, source.id);

    const content = exportSourceToJson(source);
    let unchanged = false;
    try {
      unchanged = readFileSync(destination, 'utf8') === content;
    } catch {
      // Missing or unreadable: let the atomic write report any real failure.
    }
    if (!unchanged) await writeFileAtomic(destination, content, 'utf8');

    // Keep the previous copy until its replacement is durably written. A failed
    // relocation must not erase the only captured source and all its evidence.
    for (const { file, path } of walkSources(this.directory)) {
      if (file === `${source.id}${SOURCE_SUFFIX}` && path !== destination) unlinkSync(path);
    }
  }

  delete(sourceId: string): Promise<void> {
    return this.inSourceTurn(sourceId, async () => {
      for (const { file, path } of walkSources(this.directory)) {
        if (file === `${sourceId}${SOURCE_SUFFIX}` && existsSync(path)) unlinkSync(path);
      }
    });
  }

  private read(path: string): ProjectSource | null {
    try {
      return importSourceFromJson(readFileSync(path, 'utf8'));
    } catch {
      return null;
    }
  }
}
