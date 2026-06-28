import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import writeFileAtomic from 'write-file-atomic';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { Provenance } from '$features/source-provenance/domain/Provenance';
import type { ProvenanceRepository } from '$features/source-provenance/application/ports/ProvenanceRepository';
import {
  exportProvenanceToJson,
  importProvenanceFromJson
} from '$features/source-provenance/infrastructure/io/ProvenanceJson';
import {
  PROVENANCE_SUFFIX,
  ensureProjectDir,
  findProjectSlugForFeature,
  provenanceFilePath,
  walkBySuffix
} from '$shared/infrastructure/persistence/snapshotLayout';

/**
 * Provenance sidecar persistence. `<featureId>.provenance.json` lives in the
 * same project folder as its feature. Keyed on the stable, opaque featureId
 * (not the human slug) so renaming the feature doesn't orphan or collide the
 * sidecar. Folder placement is resolved per call via `findProjectSlugForFeature`
 * so the sidecar follows its feature when it moves between projects. Mirrors
 * `JsonFolderImplementationStatusRepository`.
 */
export class JsonFolderProvenanceRepository implements ProvenanceRepository {
  constructor(private readonly directory: string) {}

  async get(id: FeatureId): Promise<Provenance | null> {
    const path = this.locate(id);
    if (!path) return null;
    try {
      return importProvenanceFromJson(readFileSync(path, 'utf8'));
    } catch {
      return null;
    }
  }

  async save(provenance: Provenance): Promise<void> {
    const ownerSlug = findProjectSlugForFeature(this.directory, String(provenance.featureId));
    ensureProjectDir(this.directory, ownerSlug);
    const destination = provenanceFilePath(this.directory, ownerSlug, String(provenance.featureId));

    // Sweep up an old sidecar if the feature moved between projects since the
    // last save, so the same featureId never ends up with stale copies.
    for (const existing of this.allPathsFor(String(provenance.featureId))) {
      if (existing !== destination) unlinkSync(existing);
    }

    await writeFileAtomic(destination, exportProvenanceToJson(provenance), 'utf8');
  }

  async delete(id: FeatureId): Promise<void> {
    for (const path of this.allPathsFor(String(id))) {
      if (existsSync(path)) unlinkSync(path);
    }
  }

  private locate(id: FeatureId): string | null {
    const matches = this.allPathsFor(String(id));
    return matches[0] ?? null;
  }

  private allPathsFor(featureId: string): readonly string[] {
    const out: string[] = [];
    for (const { file, path } of walkBySuffix(this.directory, PROVENANCE_SUFFIX)) {
      if (file === `${featureId}${PROVENANCE_SUFFIX}`) out.push(path);
    }
    return out;
  }
}
