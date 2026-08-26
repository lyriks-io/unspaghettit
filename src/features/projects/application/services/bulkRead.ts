import type { Project } from '$features/projects/domain/entities/Project';
import type { ProjectRepository } from '$features/projects/application/ports/ProjectRepository';

/** Every full project, in one store pass when the repository offers `listFull`. */
export const listAllProjects = async (repo: ProjectRepository): Promise<readonly Project[]> => {
  if (repo.listFull) return repo.listFull();
  const out: Project[] = [];
  for (const summary of await repo.list()) {
    const project = await repo.get(summary.id);
    if (project) out.push(project);
  }
  return out;
};

/** The project whose `featureIds` claim `featureId`, or null for an orphan. */
export const findOwningProject = async (
  repo: ProjectRepository,
  featureId: string
): Promise<Project | null> => {
  for (const project of await listAllProjects(repo)) {
    if (project.featureIds.some((id) => String(id) === featureId)) return project;
  }
  return null;
};
