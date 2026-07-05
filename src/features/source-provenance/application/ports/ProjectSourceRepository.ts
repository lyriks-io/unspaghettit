import type { ProjectSource } from '$features/source-provenance/domain/ProjectSource';

/**
 * Project-level source document store. Sources are immutable: there is no
 * update, only save (create), find, list, and delete. `projectId` is null for
 * the unassigned bucket (a source attached through a feature that no project
 * claims).
 */
export interface ProjectSourceRepository {
  listForProject(projectId: string | null): Promise<readonly ProjectSource[]>;
  /** Locate a source by id across every project folder. */
  find(sourceId: string): Promise<ProjectSource | null>;
  save(source: ProjectSource): Promise<void>;
  delete(sourceId: string): Promise<void>;
}
