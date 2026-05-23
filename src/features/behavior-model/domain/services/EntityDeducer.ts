import type { Feature } from '../entities/Feature';
import type { StatePath } from '../value-objects/StatePath';
import type { StateType } from '../value-objects/StateValue';
import { humanizeStatePath } from '../value-objects/humanize';

export type DeducedField = {
  readonly name: string;
  readonly path: StatePath;
  readonly type: StateType;
};

export type DeducedDataCandidate = {
  /** First segment of the dot-path; the proposed entity's namespace. */
  readonly namespace: string;
  /** Suggested human-friendly name (e.g. "User", "Cart"). */
  readonly proposedName: string;
  readonly fields: readonly DeducedField[];
  readonly usedBySurfaces: readonly string[];
};

const capitalize = (s: string): string =>
  s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);

const fieldNameFromPath = (path: string): string => {
  const segments = path.split('.');
  if (segments.length <= 1) return path;
  // Everything after the namespace becomes the field name. If there are
  // multiple sub-segments (e.g. "user.address.city"), use the last one.
  return segments[segments.length - 1] as string;
};

/**
 * Walk every state definition across every surface and group by the first
 * path segment (namespace). Each unique namespace becomes a candidate Entity
 * entity. Namespaces that already have a materialized Entity entry are skipped.
 *
 * Output is sorted alphabetically for stable rendering.
 */
export const deduceDataCandidates = (
  feature: Feature
): readonly DeducedDataCandidate[] => {
  const existingNamespaces = new Set(feature.entities.map((d) => d.namespace));

  type Acc = {
    fields: Map<string, DeducedField>; // path -> field (dedup)
    surfaces: Set<string>;
  };
  const byNamespace = new Map<string, Acc>();

  for (const surface of feature.surfaces) {
    for (const def of surface.stateDefinitions) {
      const segments = def.path.split('.');
      const namespace = segments[0] ?? def.path;
      if (existingNamespaces.has(namespace)) continue;

      let acc = byNamespace.get(namespace);
      if (!acc) {
        acc = { fields: new Map(), surfaces: new Set() };
        byNamespace.set(namespace, acc);
      }
      if (!acc.fields.has(def.path)) {
        acc.fields.set(def.path, {
          name: fieldNameFromPath(def.path),
          path: def.path,
          type: def.type
        });
      }
      acc.surfaces.add(surface.name);
    }
  }

  const candidates: DeducedDataCandidate[] = [];
  for (const [namespace, acc] of byNamespace) {
    candidates.push({
      namespace,
      proposedName: capitalize(humanizeStatePath(namespace)),
      fields: Array.from(acc.fields.values()).sort((a, b) => a.path.localeCompare(b.path)),
      usedBySurfaces: Array.from(acc.surfaces).sort()
    });
  }
  candidates.sort((a, b) => a.namespace.localeCompare(b.namespace));
  return candidates;
};
