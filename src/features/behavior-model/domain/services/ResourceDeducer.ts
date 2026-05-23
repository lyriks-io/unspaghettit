import type { Feature } from '../entities/Feature';
import { humanizeStatePath } from '../value-objects/humanize';

export type DeducedResourceCandidate = {
  /** The Entity namespace this resource would back. */
  readonly namespace: string;
  readonly proposedName: string;
  readonly reason: string;
};

const capitalize = (s: string): string =>
  s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Deduce Resource candidates from the model. The heuristic: every Entity
 * namespace that has fields but no `resourceId` is a hint that the data
 * needs a place to live. Plus every state-path namespace that exists at
 * runtime but has no Entity entity AND no resource. Also surfaced as a
 * suggestion.
 */
export const deduceResourceCandidates = (
  feature: Feature
): readonly DeducedResourceCandidate[] => {
  const candidates: DeducedResourceCandidate[] = [];
  const seen = new Set<string>();

  for (const data of feature.entities) {
    if (data.resourceId) continue;
    if (data.fields.length === 0) continue;
    if (seen.has(data.namespace)) continue;
    seen.add(data.namespace);
    const displayName = capitalize(humanizeStatePath(data.namespace));
    candidates.push({
      namespace: data.namespace,
      proposedName: displayName,
      reason: `Entity entity "${displayName}" has ${data.fields.length} field${
        data.fields.length === 1 ? '' : 's'
      } but no backing resource.`
    });
  }

  // Also flag bare state namespaces that have no Entity entity yet but are in use.
  const dataNamespaces = new Set(feature.entities.map((d) => d.namespace));
  const usedNamespaces = new Map<string, number>();
  for (const surface of feature.surfaces) {
    for (const def of surface.stateDefinitions) {
      const ns = def.path.split('.')[0] ?? def.path;
      usedNamespaces.set(ns, (usedNamespaces.get(ns) ?? 0) + 1);
    }
  }
  for (const [namespace, count] of usedNamespaces) {
    if (dataNamespaces.has(namespace)) continue;
    if (seen.has(namespace)) continue;
    seen.add(namespace);
    candidates.push({
      namespace,
      proposedName: capitalize(humanizeStatePath(namespace)),
      reason: `${count} state field${count === 1 ? '' : 's'} use the "${namespace}" namespace, but no resource catalogues where they live.`
    });
  }

  candidates.sort((a, b) => a.namespace.localeCompare(b.namespace));
  return candidates;
};
