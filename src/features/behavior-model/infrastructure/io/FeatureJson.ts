import type { Entity } from '$features/behavior-model/domain/entities/Entity';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import { normalizeFeatureEmittedEvents } from '$features/behavior-model/domain/services/FeatureEmittedEventsNormalizer';
import { normalizeFeatureExpressions } from '$features/behavior-model/domain/services/FeatureExpressionNormalizer';
import { normalizeFeatureRuleCategories } from '$features/behavior-model/domain/services/FeatureRuleCategoryNormalizer';
import { normalizeFeatureSharedState } from '$features/behavior-model/domain/services/FeatureSharedStateNormalizer';
import { normalizeTags } from '$shared/domain/Tags';

export type FeatureExportEnvelope = {
  readonly format: 'unspaghettit';
  readonly version: 1;
  readonly feature: Feature;
};

export const exportFeatureToJson = (feature: Feature): string => {
  const envelope: FeatureExportEnvelope = {
    format: 'unspaghettit',
    version: 1,
    feature
  };
  return JSON.stringify(envelope, null, 2);
};

/**
 * Pre-rename JSON snapshots stored the Surface's user-action list under the
 * key `capabilities`. The TS field is now `actions`. Migrate on read so old
 * files keep loading without a separate batch migration step. New writes
 * always use the new key.
 */
const migrateSurface = (raw: Record<string, unknown>): Surface => {
  if ('actions' in raw) return raw as unknown as Surface;
  if ('capabilities' in raw) {
    const { capabilities, ...rest } = raw;
    return { ...rest, actions: capabilities } as unknown as Surface;
  }
  return raw as unknown as Surface;
};

export const importFeatureFromJson = (raw: string): Feature => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Expected a feature export object');
  }
  // Accept both the new `feature` envelope key and the legacy `experience`
  // key so older snapshots keep loading. New writes always use `feature`.
  const envelope = parsed as {
    format?: string;
    version?: number;
    feature?: Feature;
    experience?: Feature;
  };
  if (envelope.format !== 'unspaghettit') {
    throw new Error('Not an Unspaghettit export (missing format field)');
  }
  if (envelope.version !== 1) {
    throw new Error(`Unsupported export version: ${envelope.version}`);
  }
  const feature = envelope.feature ?? envelope.experience;
  if (!feature) {
    throw new Error('Export envelope is missing a feature');
  }
  const rawSurfaces =
    (feature as unknown as { surfaces?: readonly unknown[] }).surfaces ?? [];
  const surfaces = rawSurfaces.map((s) => migrateSurface(s as Record<string, unknown>));
  // Pre-rename JSON used `data[]` for first-class entity records; new files
  // write `entities[]`. Accept either so legacy snapshots still load.
  const expRaw = feature as unknown as {
    entities?: readonly unknown[];
    data?: readonly unknown[];
  };
  const entities = (expRaw.entities ?? expRaw.data ?? []) as readonly Entity[];
  // Normalize Expression trees and emittedEvents on import so legacy
  // snapshots load with healed-in-memory data. Expression normalization
  // wraps raw scalars in `{kind:"literal",value}`; emittedEvents normalization
  // merges every emit_event effect's name into the action's declared list.
  return normalizeFeatureSharedState(
    normalizeFeatureRuleCategories(
      normalizeFeatureEmittedEvents(
        normalizeFeatureExpressions({
          ...feature,
          tags: normalizeTags(feature.tags),
          surfaces,
          personas: feature.personas ?? [],
          resources: feature.resources ?? [],
          entities
        })
      )
    )
  );
};
