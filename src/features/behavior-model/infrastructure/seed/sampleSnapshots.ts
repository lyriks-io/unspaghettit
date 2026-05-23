import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Project } from '$features/projects/domain/entities/Project';

type FeatureEnvelope = { feature: Feature };
type ProjectEnvelope = { project: Project };

// Samples are organised into per-project subfolders (samples/eshop/,
// samples/<next-sample>/, ...) to mirror the unspa/ runtime layout. The
// glob walks one level down so adding a new sample is just a new folder,
// no code change.
const featureModules = import.meta.glob<FeatureEnvelope>('/samples/*/*.feature.json', { eager: true });
const projectModules = import.meta.glob<ProjectEnvelope>('/samples/*/*.project.json', { eager: true });

const unwrap = <T>(modules: Record<string, unknown>, key: 'feature' | 'project'): readonly T[] =>
  Object.values(modules)
    .map((m) => {
      const mod = m as Record<string, unknown>;
      const direct = mod[key];
      if (direct) return direct as T;
      const def = mod.default as Record<string, unknown> | undefined;
      return (def?.[key] ?? undefined) as T | undefined;
    })
    .filter((v): v is T => Boolean(v));

export const sampleFeatureSnapshots: readonly Feature[] = unwrap<Feature>(featureModules, 'feature');
export const sampleProjectSnapshots: readonly Project[] = unwrap<Project>(projectModules, 'project');
