import { committedActions } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Project } from '$features/projects/domain/entities/Project';
import type { ImplementationStatus } from '$features/implementation-status/domain/ImplementationStatus';
import { computeImplementationBreakdown } from '$features/implementation-status/domain/ImplementationBreakdown';
import { scoreFeatureBreakdown } from '$features/maturity/domain/MaturityScorer';
import type { MaturityReport } from '$features/maturity/domain/MaturityReport';
import type { Tag } from '$shared/domain/Tags';

export type BuilderModeSuggestion = {
  readonly id: string;
  readonly tone: 'urgent' | 'next';
  readonly text: string;
};

export type BuilderModeFeature = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly maturityPercentage: number;
  readonly implementationPercentage: number | null;
  readonly suggestions: readonly BuilderModeSuggestion[];
};

export type BuilderModeCoreFeature = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly maturityPercentage: number;
  readonly implementationPercentage: number | null;
  readonly tags: readonly Tag[];
  readonly suggestions: readonly BuilderModeSuggestion[];
  readonly features: readonly BuilderModeFeature[];
};

export type BuilderModeProject = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly maturityPercentage: number;
  readonly implementationPercentage: number | null;
  readonly tags: readonly Tag[];
  readonly coreFeatures: readonly BuilderModeCoreFeature[];
};

export type BuilderModeDashboard = {
  readonly projects: readonly BuilderModeProject[];
};

export type BuilderModeProjectInput = {
  readonly project: Project;
  readonly coreFeatures: readonly {
    readonly feature: Feature;
    readonly implementationStatus: ImplementationStatus | null;
  }[];
};

const fallbackDescription = 'No description yet.';

const average = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : Math.round(values.reduce((total, value) => total + value, 0) / values.length);

const averageOptional = (values: readonly (number | null)[]): number | null => {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : average(known);
};

/**
 * Suggestions are NOT computed from maturity / implementation / the simulator.
 * They are the LLM-authored Evolutions on the feature — proposed improvements
 * the assistant raised against the product context ("competitors offer SSO",
 * "harden the password reset"). Each Evolution lives as an `evolution`-marked
 * skeleton Action; we read its name + rationale here. The deterministic numbers
 * still drive the Maturity / Built bars, but the *advice* is the model's.
 */
const evolutionSuggestions = (feature: Feature): readonly BuilderModeSuggestion[] => {
  const out: BuilderModeSuggestion[] = [];
  for (const surface of feature.surfaces) {
    for (const action of surface.actions) {
      const evolution = action.evolution;
      // Dismissed proposals stay in the spec (as a tombstone for the assistant)
      // but are hidden from the user's suggestions list.
      if (!evolution || evolution.dismissed) continue;
      const detail = evolution.source
        ? `${evolution.rationale} (${evolution.source})`
        : evolution.rationale;
      out.push({
        id: String(action.id),
        // Security / compliance ideas read as higher-priority; everything else
        // is a forward-looking "improve". Tone is cosmetic only.
        tone:
          evolution.category === 'security' || evolution.category === 'compliance'
            ? 'urgent'
            : 'next',
        // Plain colon, no em dash — keeps the line readable for novice users.
        text: `${action.name}: ${detail}`
      });
    }
  }
  return out;
};

export const buildBuilderModeDashboard = (
  inputs: readonly BuilderModeProjectInput[]
): BuilderModeDashboard => ({
  projects: inputs.map(({ project, coreFeatures }) => {
    const mappedCoreFeatures = coreFeatures.map(({ feature, implementationStatus }) => {
      const maturity = scoreFeatureBreakdown(feature);
      const implementation = computeImplementationBreakdown(feature, implementationStatus);
      const actionReports = new Map<string, MaturityReport>();
      for (const surface of maturity.perSurface) {
        for (const entry of surface.perAction) {
          actionReports.set(String(entry.action.id), entry.report);
        }
      }
      const implementationByAction = new Map(
        implementation.perSurface.flatMap((surface) =>
          surface.perAction.map((entry) => [String(entry.action.id), entry] as const)
        )
      );

      const features: BuilderModeFeature[] = feature.surfaces.flatMap((surface) =>
        committedActions(surface.actions).map((action) => {
          const actionReport = actionReports.get(String(action.id));
          const actionImplementation = implementationByAction.get(String(action.id));
          const implementationPercentage =
            actionImplementation && actionImplementation.expectedCount > 0
              ? actionImplementation.percentage
              : null;
          return {
            id: String(action.id),
            name: action.name,
            description: action.intent || fallbackDescription,
            maturityPercentage: actionReport?.percentage ?? 0,
            implementationPercentage,
            // Per-action advice was deterministic noise; suggestions now live at
            // the feature level as the model's Evolutions.
            suggestions: []
          };
        })
      );

      const coreImplementationPercentage =
        implementation.expectedCount === 0 ? null : implementation.percentage;

      return {
        id: String(feature.id),
        name: feature.name,
        description: feature.description || fallbackDescription,
        maturityPercentage: maturity.global.percentage,
        implementationPercentage: coreImplementationPercentage,
        tags: feature.tags ?? [],
        suggestions: evolutionSuggestions(feature),
        features
      };
    });

    return {
      id: String(project.id),
      name: project.name,
      description: project.description || fallbackDescription,
      maturityPercentage: average(mappedCoreFeatures.map((feature) => feature.maturityPercentage)),
      implementationPercentage: averageOptional(
        mappedCoreFeatures.map((feature) => feature.implementationPercentage)
      ),
      tags: project.tags ?? [],
      coreFeatures: mappedCoreFeatures
    };
  })
});
