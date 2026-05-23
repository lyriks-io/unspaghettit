import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import writeFileAtomic from 'write-file-atomic';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { ImplementationStatus } from '$features/implementation-status/domain/ImplementationStatus';
import type { ImplementationStatusRepository } from '$features/implementation-status/application/ports/ImplementationStatusRepository';
import {
  exportImplementationStatusToJson,
  importImplementationStatusFromJson
} from '$features/implementation-status/infrastructure/io/ImplementationStatusJson';
import {
  STATUS_SUFFIX,
  ensureProjectDir,
  findProjectSlugForFeature,
  statusFilePath,
  walkBySuffix
} from '$shared/infrastructure/persistence/snapshotLayout';

/**
 * Sidecar persistence. `<featureId>.implementation-status.json` lives in the
 * same project folder as its feature. The filename keys on the (stable, opaque)
 * featureId rather than the human slug so that renaming the feature doesn't
 * orphan or collide the sidecar.
 *
 * Folder placement is resolved per call via `findProjectSlugForFeature`. When
 * a feature is reassigned to another project, the next save lands in the new
 * folder; the old sidecar gets cleaned up on the next save.
 */
export class JsonFolderImplementationStatusRepository
  implements ImplementationStatusRepository
{
  constructor(private readonly directory: string) {}

  async get(id: FeatureId): Promise<ImplementationStatus | null> {
    const path = this.locate(id);
    if (!path) return null;
    try {
      return importImplementationStatusFromJson(readFileSync(path, 'utf8'));
    } catch {
      return null;
    }
  }

  async save(status: ImplementationStatus): Promise<void> {
    const ownerSlug = findProjectSlugForFeature(this.directory, String(status.featureId));
    ensureProjectDir(this.directory, ownerSlug);
    const destination = statusFilePath(this.directory, ownerSlug, String(status.featureId));

    // Sweep up an old sidecar if the feature moved between projects since the
    // last save. Without this the same featureId would end up with stale
    // copies in two folders.
    for (const existing of this.allPathsFor(String(status.featureId))) {
      if (existing !== destination) unlinkSync(existing);
    }

    await writeFileAtomic(destination, exportImplementationStatusToJson(status), 'utf8');
  }

  async delete(id: FeatureId): Promise<void> {
    for (const path of this.allPathsFor(String(id))) {
      if (existsSync(path)) unlinkSync(path);
    }
  }

  /** First sidecar found across project folders for this featureId, or null. */
  private locate(id: FeatureId): string | null {
    const matches = this.allPathsFor(String(id));
    return matches[0] ?? null;
  }

  /** Every sidecar path that matches `<featureId>.implementation-status.json`. */
  private allPathsFor(featureId: string): readonly string[] {
    const out: string[] = [];
    for (const { file, path } of walkBySuffix(this.directory, STATUS_SUFFIX)) {
      if (file === `${featureId}${STATUS_SUFFIX}`) out.push(path);
    }
    return out;
  }
}
