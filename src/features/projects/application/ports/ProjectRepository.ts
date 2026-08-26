import type { Project } from '$features/projects/domain/entities/Project';
import type { Tag } from '$shared/domain/Tags';
import type { ProjectId } from '$features/projects/domain/value-objects/ids';

export type ProjectSummary = {
  readonly id: ProjectId;
  readonly name: string;
  readonly description?: string;
  readonly tags?: readonly Tag[];
  readonly customTagType?: string;
  readonly customTag?: string;
  readonly featureCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export interface ProjectRepository {
  list(): Promise<readonly ProjectSummary[]>;
  get(id: ProjectId): Promise<Project | null>;
  save(project: Project): Promise<void>;
  delete(id: ProjectId): Promise<void>;
  /** Every full project in one pass; see `FeatureRepository.listFull`. */
  listFull?(): Promise<readonly Project[]>;
}
