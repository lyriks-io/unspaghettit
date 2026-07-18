import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Resource } from '$features/behavior-model/domain/entities/Resource';
import { getEffectiveEntities } from '$features/behavior-model/domain/services/EffectiveEntities';
import { buildEventCatalog } from '$features/behavior-model/domain/services/EventCatalog';
import { buildTransitionCatalog } from '$features/behavior-model/domain/services/TransitionCatalog';

/**
 * Same logical resource/entity/event/transition often lives in several
 * features inside one project (a `users` table read by two flows, a
 * `cart.cleared` event emitted from two features, ...). The per-feature
 * panels under the editor treat them as distinct rows, but the project-level
 * tabs should collapse them: one row per unique item, with every feature
 * that contributes listed as an attribution.
 *
 * Each grouped row preserves the first occurrence's metadata (fields the
 * same logical item should agree on) and combines counters that genuinely
 * sum across features (emissions, transition sources).
 */

export type FeatureAttribution = {
  readonly featureId: string;
  readonly featureName: string;
};

export type GroupedResource = {
  readonly key: string;
  readonly name: string;
  readonly kind: string;
  readonly provider: string;
  readonly scope: string;
  readonly sensitivity: string;
  readonly containsPii: boolean;
  readonly description?: string;
  readonly sources: readonly FeatureAttribution[];
};

export type GroupedEntity = {
  readonly key: string;
  readonly namespace: string;
  readonly description?: string;
  readonly fieldCount: number;
  readonly sources: readonly FeatureAttribution[];
};

export type GroupedEvent = {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly payloadFieldCount: number;
  readonly emissions: number;
  readonly sources: readonly FeatureAttribution[];
};

export type GroupedTransition = {
  readonly key: string;
  readonly sourceName: string;
  readonly targetName: string;
  readonly label?: string;
  readonly sourcesCount: number;
  readonly sources: readonly FeatureAttribution[];
};

const resourceKey = (r: Resource): string => `${r.kind}|${r.provider}|${r.name}`.toLowerCase();

export const groupResources = (features: readonly Feature[]): readonly GroupedResource[] => {
  const map = new Map<string, GroupedResource & { sources: FeatureAttribution[] }>();
  for (const e of features) {
    for (const r of e.resources) {
      const key = resourceKey(r);
      const attribution = { featureId: String(e.id), featureName: e.name };
      const existing = map.get(key);
      if (existing) {
        if (!existing.sources.some((s) => s.featureId === attribution.featureId)) {
          existing.sources.push(attribution);
        }
        continue;
      }
      map.set(key, {
        key,
        name: r.name,
        kind: r.kind,
        provider: r.provider,
        scope: r.scope,
        sensitivity: r.sensitivity,
        containsPii: r.containsPii,
        description: r.description,
        sources: [attribution]
      });
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
};

export const groupEntities = (features: readonly Feature[]): readonly GroupedEntity[] => {
  const map = new Map<string, GroupedEntity & { sources: FeatureAttribution[] }>();
  for (const e of features) {
    for (const d of getEffectiveEntities(e)) {
      const key = d.namespace.toLowerCase();
      const attribution = { featureId: String(e.id), featureName: e.name };
      const existing = map.get(key);
      if (existing) {
        if (!existing.sources.some((s) => s.featureId === attribution.featureId)) {
          existing.sources.push(attribution);
        }
        // Keep the richest field count seen so far - the same namespace may
        // be declared with different field sets across features.
        if (d.fields.length > existing.fieldCount) {
          (existing as { fieldCount: number }).fieldCount = d.fields.length;
        }
        if (!existing.description && d.description) {
          (existing as { description?: string }).description = d.description;
        }
        continue;
      }
      map.set(key, {
        key,
        namespace: d.namespace,
        description: d.description,
        fieldCount: d.fields.length,
        sources: [attribution]
      });
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.namespace.localeCompare(b.namespace, undefined, { sensitivity: 'base' })
  );
};

export const groupEvents = (features: readonly Feature[]): readonly GroupedEvent[] => {
  const map = new Map<string, GroupedEvent & { sources: FeatureAttribution[] }>();
  for (const e of features) {
    const registered = new Map((e.events ?? []).map((ev) => [String(ev.name), ev]));
    for (const entry of buildEventCatalog(e)) {
      const name = String(entry.name);
      const key = name.toLowerCase();
      const declared = registered.get(name);
      const attribution = { featureId: String(e.id), featureName: e.name };
      const existing = map.get(key);
      if (existing) {
        if (!existing.sources.some((s) => s.featureId === attribution.featureId)) {
          existing.sources.push(attribution);
        }
        (existing as { emissions: number }).emissions += entry.emissions.length;
        if (declared) {
          if (!existing.description && declared.description) {
            (existing as { description?: string }).description = declared.description;
          }
          const declaredFields = declared.payloadSchema?.length ?? 0;
          if (declaredFields > existing.payloadFieldCount) {
            (existing as { payloadFieldCount: number }).payloadFieldCount = declaredFields;
          }
        }
        continue;
      }
      map.set(key, {
        key,
        name,
        description: declared?.description,
        payloadFieldCount: declared?.payloadSchema?.length ?? 0,
        emissions: entry.emissions.length,
        sources: [attribution]
      });
    }
  }
  return Array.from(map.values());
};

export const groupTransitions = (features: readonly Feature[]): readonly GroupedTransition[] => {
  const map = new Map<string, GroupedTransition & { sources: FeatureAttribution[] }>();
  for (const e of features) {
    for (const entry of buildTransitionCatalog(e)) {
      const label = entry.sources[0]?.description;
      const key = `${entry.fromSurfaceName}|${entry.toSurfaceName}|${label ?? ''}`.toLowerCase();
      const attribution = { featureId: String(e.id), featureName: e.name };
      const existing = map.get(key);
      if (existing) {
        if (!existing.sources.some((s) => s.featureId === attribution.featureId)) {
          existing.sources.push(attribution);
        }
        (existing as { sourcesCount: number }).sourcesCount += entry.sources.length;
        continue;
      }
      map.set(key, {
        key,
        sourceName: entry.fromSurfaceName,
        targetName: entry.toSurfaceName,
        label,
        sourcesCount: entry.sources.length,
        sources: [attribution]
      });
    }
  }
  return Array.from(map.values());
};
