import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { FeatureRepository } from '../ports/FeatureRepository';
import type { Project } from '$features/projects/domain/entities/Project';
import type { ProjectRepository } from '$features/projects/application/ports/ProjectRepository';

export type SampleEntry = { readonly id: string; readonly name: string };

export type LoadSamplesResult = {
  readonly addedProjects: readonly SampleEntry[];
  readonly addedFeatures: readonly SampleEntry[];
  readonly skippedProjects: readonly SampleEntry[];
  readonly skippedFeatures: readonly SampleEntry[];
};

export const loadSamplesUseCase = (deps: {
  repository: FeatureRepository;
  projectRepository: ProjectRepository;
  samples: readonly Feature[];
  projectSamples: readonly Project[];
}) => {
  return async (): Promise<LoadSamplesResult> => {
    const addedFeatures: SampleEntry[] = [];
    const skippedFeatures: SampleEntry[] = [];
    const addedProjects: SampleEntry[] = [];
    const skippedProjects: SampleEntry[] = [];
    for (const sample of deps.samples) {
      const existing = await deps.repository.get(sample.id);
      if (existing) {
        skippedFeatures.push({ id: String(sample.id), name: sample.name });
        continue;
      }
      await deps.repository.save(sample);
      addedFeatures.push({ id: String(sample.id), name: sample.name });
    }
    for (const project of deps.projectSamples) {
      const existing = await deps.projectRepository.get(project.id);
      if (existing) {
        skippedProjects.push({ id: String(project.id), name: project.name });
        continue;
      }
      await deps.projectRepository.save(project);
      addedProjects.push({ id: String(project.id), name: project.name });
    }
    return { addedProjects, addedFeatures, skippedProjects, skippedFeatures };
  };
};
