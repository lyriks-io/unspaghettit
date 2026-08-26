import type {
  FeatureRepository,
  FeatureSummary
} from '../src/features/behavior-model/application/ports/FeatureRepository';
import type { Feature } from '../src/features/behavior-model/domain/entities/Feature';
import type { FeatureId } from '../src/features/behavior-model/domain/value-objects/ids';
import type {
  ProjectRepository,
  ProjectSummary
} from '../src/features/projects/application/ports/ProjectRepository';
import type { Project } from '../src/features/projects/domain/entities/Project';
import type { ProjectId } from '../src/features/projects/domain/value-objects/ids';
import type { ImplementationStatusRepository } from '../src/features/implementation-status/application/ports/ImplementationStatusRepository';
import type { ImplementationStatus } from '../src/features/implementation-status/domain/ImplementationStatus';
import { listAllFeatures } from '../src/features/behavior-model/application/services/bulkRead';
import { listAllProjects } from '../src/features/projects/application/services/bulkRead';
import { notifySyncReload } from './sync-notifier';

export class SyncAwareFeatureRepository implements FeatureRepository {
  constructor(private readonly inner: FeatureRepository) {}
  list(): Promise<readonly FeatureSummary[]> {
    return this.inner.list();
  }
  get(id: FeatureId): Promise<Feature | null> {
    return this.inner.get(id);
  }
  listFull(): Promise<readonly Feature[]> {
    return listAllFeatures(this.inner);
  }
  async save(feature: Feature): Promise<void> {
    await this.inner.save(feature);
    void notifySyncReload('feature', feature.id, { name: feature.name, op: 'save' });
  }
  async delete(id: FeatureId): Promise<void> {
    // Capture the name BEFORE deleting so the toast can say "deleted feature
    // 'Smoke Test'" instead of a bare id. One extra disk read per delete is
    // a cheap price for readable activity logs.
    const existing = await this.inner.get(id);
    await this.inner.delete(id);
    void notifySyncReload('feature', id, {
      op: 'delete',
      ...(existing?.name ? { name: existing.name } : {})
    });
  }
}

export class SyncAwareProjectRepository implements ProjectRepository {
  constructor(private readonly inner: ProjectRepository) {}
  list(): Promise<readonly ProjectSummary[]> {
    return this.inner.list();
  }
  get(id: ProjectId): Promise<Project | null> {
    return this.inner.get(id);
  }
  listFull(): Promise<readonly Project[]> {
    return listAllProjects(this.inner);
  }
  async save(project: Project): Promise<void> {
    await this.inner.save(project);
    void notifySyncReload('project', project.id, { name: project.name, op: 'save' });
  }
  async delete(id: ProjectId): Promise<void> {
    const existing = await this.inner.get(id);
    await this.inner.delete(id);
    void notifySyncReload('project', id, {
      op: 'delete',
      ...(existing?.name ? { name: existing.name } : {})
    });
  }
}

export class SyncAwareImplementationStatusRepository
  implements ImplementationStatusRepository
{
  constructor(private readonly inner: ImplementationStatusRepository) {}
  get(id: FeatureId): Promise<ImplementationStatus | null> {
    return this.inner.get(id);
  }
  async save(status: ImplementationStatus): Promise<void> {
    await this.inner.save(status);
    void notifySyncReload('implementation-status', status.featureId);
  }
  async delete(id: FeatureId): Promise<void> {
    await this.inner.delete(id);
    void notifySyncReload('implementation-status', id);
  }
}
