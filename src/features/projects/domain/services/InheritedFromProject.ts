import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { EventDefinition } from '$features/behavior-model/domain/entities/EventDefinition';
import type { Resource } from '$features/behavior-model/domain/entities/Resource';
import type { Entity } from '$features/behavior-model/domain/entities/Entity';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';

/**
 * Every inherited row carries its source feature so the editor can
 * render a "from <Feature>" badge next to it. Sibling entities are
 * read-only; only the open feature can be edited.
 */
export type WithSource<T> = {
  readonly value: T;
  readonly sourceFeatureId: FeatureId;
  readonly sourceFeatureName: string;
};

export type InheritedTransition = {
  readonly id: string;
  readonly surfaceId: string;
  readonly surfaceName: string;
  /** Target surface id (raw, for click-through / lookup). */
  readonly target: string;
  /** Human-readable target name resolved from the source feature's surfaces. Falls back to the id when broken. */
  readonly targetName: string;
  /** True when `target` doesn't resolve to a surface in the source feature. */
  readonly targetMissing: boolean;
  readonly label?: string;
};

/**
 * Flat union of every resource/data/event/transition contributed by sibling
 * features in the same project. Dedup keys are entity-stable (resource.id,
 * data.id, event.name) so multiple siblings with the same shared entity show
 * up once, tagged with the first sibling that defines it.
 */
export const inheritedResources = (
  siblings: readonly Feature[]
): readonly WithSource<Resource>[] => {
  const seen = new Set<string>();
  const out: WithSource<Resource>[] = [];
  for (const sibling of siblings) {
    for (const r of sibling.resources) {
      const key = String(r.id);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        value: r,
        sourceFeatureId: sibling.id,
        sourceFeatureName: sibling.name
      });
    }
  }
  return out;
};

export const inheritedData = (
  siblings: readonly Feature[]
): readonly WithSource<Entity>[] => {
  const seen = new Set<string>();
  const out: WithSource<Entity>[] = [];
  for (const sibling of siblings) {
    for (const d of sibling.entities) {
      const key = String(d.id);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        value: d,
        sourceFeatureId: sibling.id,
        sourceFeatureName: sibling.name
      });
    }
  }
  return out;
};

export const inheritedEvents = (
  siblings: readonly Feature[]
): readonly WithSource<EventDefinition>[] => {
  const seen = new Set<string>();
  const out: WithSource<EventDefinition>[] = [];
  for (const sibling of siblings) {
    for (const e of sibling.events ?? []) {
      const key = String(e.name);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        value: e,
        sourceFeatureId: sibling.id,
        sourceFeatureName: sibling.name
      });
    }
  }
  return out;
};

export const inheritedTransitions = (
  siblings: readonly Feature[]
): readonly WithSource<InheritedTransition>[] => {
  const out: WithSource<InheritedTransition>[] = [];
  for (const sibling of siblings) {
    // Build a name lookup once per sibling so the inner loop can resolve
    // target ids → human names cheaply. A transition always points at a
    // surface in the SAME feature, so the lookup is feature-local.
    const surfaceNameById = new Map<string, string>();
    for (const surface of sibling.surfaces) {
      surfaceNameById.set(String(surface.id), surface.name);
    }
    for (const surface of sibling.surfaces) {
      for (const t of surface.transitions) {
        const targetId = String(t.target);
        const targetName = surfaceNameById.get(targetId);
        const transition: InheritedTransition = {
          id: String(t.id),
          surfaceId: String(surface.id),
          surfaceName: surface.name,
          target: targetId,
          targetName: targetName ?? targetId,
          targetMissing: targetName === undefined,
          ...(t.label !== undefined ? { label: t.label } : {})
        };
        out.push({
          value: transition,
          sourceFeatureId: sibling.id,
          sourceFeatureName: sibling.name
        });
      }
    }
  }
  return out;
};
