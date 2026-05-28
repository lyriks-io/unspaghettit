import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import writeFileAtomic from 'write-file-atomic';
import type {
  FeatureRepository,
  FeatureSummary
} from '$features/behavior-model/application/ports/FeatureRepository';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import { normalizeTags } from '$shared/domain/Tags';
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
  walkBySuffix
} from '$shared/infrastructure/persistence/snapshotLayout';

// Folder name -> project slug | null (null = orphan / __unassigned/).
const folderToSlug = (folder: string): string | null =>
  folder === UNASSIGNED_FOLDER ? null : folder;

type LoadedSnapshot = {
  readonly folder: string;
  readonly slug: string;
  readonly feature: Feature;
};

const toSummary = (e: Feature): FeatureSummary => ({
  id: e.id,
  name: e.name,
  description: e.description,
  tags: normalizeTags(e.tags),
  surfaceCount: e.surfaces.length,
  actionCount: e.surfaces.reduce((acc, s) => acc + s.actions.length, 0),
  createdAt: e.createdAt,
  updatedAt: e.updatedAt
});

const slugify = (name: string): string => {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base.length > 0 ? base : 'feature';
};

export class JsonFolderFeatureRepository implements FeatureRepository {
  constructor(private readonly directory: string) {}

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
    const target = slugify(feature.name);
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
    for (const { folder, file, path } of walkBySuffix(this.directory, FEATURE_SUFFIX)) {
      try {
        const feature = importFeatureFromJson(readFileSync(path, 'utf8'));
        out.push({
          folder,
          slug: file.slice(0, -FEATURE_SUFFIX.length),
          feature
        });
      } catch {
        // Malformed snapshots are skipped so one bad file can't kill the MCP;
        // a future doctor tool will surface them.
      }
    }
    return out;
  }
}
