import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { FeatureRepository } from '$features/behavior-model/application/ports/FeatureRepository';
import type { CoreFeature } from '$features/projects/domain/entities/CoreFeature';
import {
  coreFeatureReport,
  type CoreFeatureGroup,
  type CoreFeatureMemberRef,
  type CoreFeatureWarning
} from '$features/projects/domain/services/coreFeatures';
import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import type { ProjectRepository } from '../ports/ProjectRepository';
import type { StateVariable } from '$features/projects/domain/entities/StateVariable';
import {
  projectStateVariables,
  stateCoherenceIssues,
  type StateCoherenceIssue
} from '$features/projects/domain/services/stateRegistry';
import {
  rollupActions,
  type ActionCatalogEntry,
  type ActionConcept,
  type ActionStats
} from '$features/behavior-model/domain/services/ActionRollup';

export type AggregatedResource = {
  readonly featureId: FeatureId;
  readonly featureName: string;
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly provider: string;
  readonly sensitivity: string;
};

export type AggregatedData = {
  readonly featureId: FeatureId;
  readonly featureName: string;
  readonly id: string;
  readonly namespace: string;
  readonly fieldCount: number;
};

export type AggregatedEvent = {
  readonly featureId: FeatureId;
  readonly featureName: string;
  readonly id: string;
  readonly name: string;
};

export type AggregatedTransition = {
  readonly featureId: FeatureId;
  readonly featureName: string;
  readonly surfaceId: string;
  readonly surfaceName: string;
  readonly id: string;
  readonly label?: string;
  readonly target: string;
};

export type ProjectAggregateRead = {
  readonly projectId: ProjectId;
  readonly projectName: string;
  readonly featureCount: number;
  readonly features: readonly { readonly id: FeatureId; readonly name: string }[];
  readonly missingFeatureIds: readonly FeatureId[];
  readonly resources: readonly AggregatedResource[];
  readonly data: readonly AggregatedData[];
  readonly events: readonly AggregatedEvent[];
  readonly transitions: readonly AggregatedTransition[];
  readonly stateVariables: readonly StateVariable[];
  readonly stateCoherenceIssues: readonly StateCoherenceIssue[];
  readonly actionStats: ActionStats;
  readonly actions: readonly ActionCatalogEntry[];
  readonly actionConcepts: readonly ActionConcept[];
  /** The project's declared core-feature registry (the controlled vocabulary). */
  readonly coreFeatures: readonly CoreFeature[];
  /** Each declared core feature with the member features tagged into it. */
  readonly coreFeatureGroups: readonly CoreFeatureGroup[];
  /** Features carrying no core: tag. */
  readonly coreFeatureUncategorized: readonly CoreFeatureMemberRef[];
  /** Soft warnings: a core: tag naming an undeclared value, or more than one. */
  readonly coreFeatureWarnings: readonly CoreFeatureWarning[];
};

export const getProjectAggregateUseCase = (deps: {
  projects: ProjectRepository;
  features: FeatureRepository;
}) => {
  return async (projectId: ProjectId): Promise<ProjectAggregateRead | null> => {
    const project = await deps.projects.get(projectId);
    if (!project) return null;

    // Load all features concurrently: over HTTP (dashboard) each get() is a
    // full round trip, so a sequential loop makes the aggregate cost scale
    // linearly with project size. Promise.all keeps featureIds order.
    const fetched = await Promise.all(
      project.featureIds.map(async (id) => ({ id, exp: await deps.features.get(id) }))
    );
    const loaded: Feature[] = [];
    const missingFeatureIds: FeatureId[] = [];
    for (const { id, exp } of fetched) {
      if (exp) loaded.push(exp);
      else missingFeatureIds.push(id);
    }

    const resources: AggregatedResource[] = [];
    const data: AggregatedData[] = [];
    const events: AggregatedEvent[] = [];
    const transitions: AggregatedTransition[] = [];

    for (const exp of loaded) {
      for (const r of exp.resources) {
        resources.push({
          featureId: exp.id,
          featureName: exp.name,
          id: String(r.id),
          name: r.name,
          kind: r.kind,
          provider: r.provider,
          sensitivity: r.sensitivity
        });
      }
      for (const d of exp.entities) {
        data.push({
          featureId: exp.id,
          featureName: exp.name,
          id: String(d.id),
          namespace: d.namespace,
          fieldCount: d.fields.length
        });
      }
      for (const e of exp.events ?? []) {
        events.push({
          featureId: exp.id,
          featureName: exp.name,
          id: String(e.id),
          name: String(e.name)
        });
      }
      for (const surface of exp.surfaces) {
        for (const t of surface.transitions) {
          transitions.push({
            featureId: exp.id,
            featureName: exp.name,
            surfaceId: String(surface.id),
            surfaceName: surface.name,
            id: String(t.id),
            ...(t.label !== undefined ? { label: t.label } : {}),
            target: String(t.target)
          });
        }
      }
    }

    const core = coreFeatureReport(project, loaded);
    const stateVariables = projectStateVariables(project, loaded);
    const actionRollup = rollupActions(loaded);

    return {
      projectId: project.id,
      projectName: project.name,
      featureCount: project.featureIds.length,
      features: loaded.map((e) => ({ id: e.id, name: e.name })),
      missingFeatureIds,
      resources,
      data,
      events,
      transitions,
      stateVariables,
      stateCoherenceIssues: stateCoherenceIssues(stateVariables, loaded),
      actionStats: actionRollup.stats,
      actions: actionRollup.actions,
      actionConcepts: actionRollup.concepts,
      coreFeatures: project.coreFeatures ?? [],
      coreFeatureGroups: core.groups,
      coreFeatureUncategorized: core.uncategorized,
      coreFeatureWarnings: core.warnings
    };
  };
};
