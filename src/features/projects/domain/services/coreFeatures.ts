import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import { coreValuesOf } from '$shared/domain/coreFeatureTag';
import type { CoreFeature } from '../entities/CoreFeature';
import type { Project } from '../entities/Project';

const norm = (value: string): string => value.trim().toLowerCase();

/** Whether `value` is a declared core feature of the project. */
export const isDeclaredCoreFeature = (project: Project, value: string): boolean =>
  (project.coreFeatures ?? []).some((c) => norm(c.value) === norm(value));

// ─── Registry transforms ───────────────────────────────────────────────────────
// Pure add/update/remove over `project.coreFeatures`. The registry is the
// controlled vocabulary; membership itself lives on features as `core:` tags.

/** Upsert: declaring an existing value updates its description (idempotent). */
export const declareCoreFeature = (project: Project, core: CoreFeature): Project => {
  const value = norm(core.value);
  const entry: CoreFeature = { value, description: core.description };
  const existing = project.coreFeatures ?? [];
  const next = existing.some((c) => norm(c.value) === value)
    ? existing.map((c) => (norm(c.value) === value ? entry : c))
    : [...existing, entry];
  return { ...project, coreFeatures: next };
};

/** Patch a declared core feature's description (the value is its key, not editable here). */
export const updateCoreFeature = (
  project: Project,
  value: string,
  patch: Partial<Omit<CoreFeature, 'value'>>
): Project => ({
  ...project,
  coreFeatures: (project.coreFeatures ?? []).map((c) =>
    norm(c.value) === norm(value) ? { ...c, ...patch } : c
  )
});

/**
 * Remove a declared core feature from the registry. Member features keep their
 * `core:<value>` tag; those simply become "undeclared" in the report until they
 * are re-tagged, matching the soft-warning contract (removal never rewrites
 * features).
 */
export const removeCoreFeature = (project: Project, value: string): Project => ({
  ...project,
  coreFeatures: (project.coreFeatures ?? []).filter((c) => norm(c.value) !== norm(value))
});

// ─── Grouping + soft warnings ──────────────────────────────────────────────────
// Cross-entity view: which features belong to which declared core feature, which
// are uncategorized, and the soft warnings (undeclared value, more than one core
// tag). Nothing here blocks a save; it is what the dashboard and the project
// aggregate render so the core-feature grouping stays honest and precise.

export type CoreFeatureMemberRef = {
  readonly id: FeatureId;
  readonly name: string;
};

export type CoreFeatureGroup = {
  readonly value: string;
  readonly description: string;
  readonly features: readonly CoreFeatureMemberRef[];
};

export type CoreFeatureWarning = {
  readonly featureId: FeatureId;
  readonly featureName: string;
  readonly kind: 'undeclared' | 'multiple';
  readonly detail: string;
};

export type CoreFeatureReport = {
  /** One group per DECLARED core feature (registry order), members included. */
  readonly groups: readonly CoreFeatureGroup[];
  /** Features carrying no `core:` tag at all. */
  readonly uncategorized: readonly CoreFeatureMemberRef[];
  readonly warnings: readonly CoreFeatureWarning[];
};

export const coreFeatureReport = (
  project: Project,
  features: readonly Feature[]
): CoreFeatureReport => {
  const declared = project.coreFeatures ?? [];
  const members = new Map<string, CoreFeatureMemberRef[]>();
  for (const c of declared) members.set(norm(c.value), []);

  const uncategorized: CoreFeatureMemberRef[] = [];
  const warnings: CoreFeatureWarning[] = [];

  for (const feature of features) {
    const values = [...new Set(coreValuesOf(feature.tags))];
    const ref: CoreFeatureMemberRef = { id: feature.id, name: feature.name };

    if (values.length === 0) {
      uncategorized.push(ref);
      continue;
    }
    if (values.length > 1) {
      warnings.push({
        featureId: feature.id,
        featureName: feature.name,
        kind: 'multiple',
        detail: `Belongs to ${values.length} core features (${values.join(', ')}); a feature should belong to at most one.`
      });
    }
    for (const value of values) {
      const bucket = members.get(value);
      if (bucket) {
        bucket.push(ref);
      } else {
        warnings.push({
          featureId: feature.id,
          featureName: feature.name,
          kind: 'undeclared',
          detail: `Tagged core:${value}, which is not a declared core feature of this project. Declare it, or fix the tag.`
        });
      }
    }
  }

  return {
    groups: declared.map((c) => ({
      value: norm(c.value),
      description: c.description,
      features: members.get(norm(c.value)) ?? []
    })),
    uncategorized,
    warnings
  };
};
