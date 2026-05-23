import type { Entity, EntityField } from '../entities/Entity';
import type { Feature } from '../entities/Feature';
import type { EntityFieldType } from '../value-objects/EntityFieldType';
import type { EntityFieldId, EntityId, ResourceId } from '../value-objects/ids';
import type { StatePath } from '../value-objects/StatePath';
import { humanizeStatePath } from '../value-objects/humanize';

/**
 * Where each piece of an EffectiveEntities came from. Deduced fields are inferred
 * from state-path namespaces; declared fields were explicitly authored on a
 * Entity entity.
 */
export type FieldSource = 'deduced' | 'declared';

export type EffectiveDataField = {
  readonly id?: EntityFieldId;
  readonly name: string;
  readonly path: StatePath;
  readonly type: EntityFieldType;
  readonly source: FieldSource;
  /** type='object' nested fields (declared only). */
  readonly fields?: readonly EntityField[];
  /** type='array' element schema (declared only). */
  readonly items?: EntityField;
};

/**
 * The unified view of a Entity entity that the UI consumes. Combines:
 *  - state-path namespaces in the feature (always present), and
 *  - any explicitly authored Entity record (optional overrides).
 *
 * "Materialized" means a `Entity` record exists in `feature.entities`. Editing
 * an unmaterialized entry should lazily create one so the metadata
 * (description, resource link, custom name) has somewhere to live.
 */
export type EffectiveEntities = {
  readonly id?: EntityId;
  readonly name: string;
  readonly namespace: string;
  readonly description?: string;
  readonly resourceId?: ResourceId;
  readonly fields: readonly EffectiveDataField[];
  readonly isMaterialized: boolean;
  readonly usedBySurfaces: readonly string[];
};

const capitalize = (s: string): string =>
  s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);

const fieldNameFromPath = (path: string): string => {
  const segments = path.split('.');
  if (segments.length <= 1) return path;
  return segments[segments.length - 1] as string;
};

/**
 * Produce the list of all Entity entities visible in the feature. Every
 * state-path namespace, enriched with metadata from any matching authored
 * `Entity` record. Authored entries with no matching state paths still appear
 * (so the user doesn't lose explicit work).
 */
export const getEffectiveEntities = (feature: Feature): readonly EffectiveEntities[] => {
  type DeducedAcc = {
    readonly fields: Map<string, EffectiveDataField>;
    readonly surfaces: Set<string>;
  };
  const deduced = new Map<string, DeducedAcc>();

  for (const surface of feature.surfaces) {
    for (const def of surface.stateDefinitions) {
      const namespace = def.path.split('.')[0] ?? def.path;
      let acc = deduced.get(namespace);
      if (!acc) {
        acc = { fields: new Map(), surfaces: new Set() };
        deduced.set(namespace, acc);
      }
      if (!acc.fields.has(def.path)) {
        acc.fields.set(def.path, {
          name: fieldNameFromPath(def.path),
          path: def.path,
          type: def.type,
          source: 'deduced'
        });
      }
      acc.surfaces.add(surface.name);
    }
  }

  const declaredByNamespace = new Map<string, Entity>();
  for (const data of feature.entities) {
    declaredByNamespace.set(data.namespace, data);
  }

  const namespaces = new Set<string>([
    ...deduced.keys(),
    ...declaredByNamespace.keys()
  ]);

  const results: EffectiveEntities[] = [];
  for (const namespace of namespaces) {
    const declared = declaredByNamespace.get(namespace);
    const acc = deduced.get(namespace);

    // Build the field map. Start with deduced fields, then layer declared
    // fields. A declared field with the same path overrides type/name and
    // marks the source as "declared".
    const fieldByPath = new Map<string, EffectiveDataField>();
    if (acc) {
      for (const [path, f] of acc.fields) fieldByPath.set(path, f);
    }
    if (declared) {
      for (const f of declared.fields) {
        // Declared fields without a path can't surface in the effective view
        // (they live inside an object/array and don't map to a state path).
        if (!f.path) continue;
        fieldByPath.set(String(f.path), {
          id: f.id,
          name: f.name,
          path: f.path,
          type: f.type,
          source: 'declared',
          fields: f.fields,
          items: f.items
        });
      }
    }

    const fields = Array.from(fieldByPath.values()).sort((a, b) =>
      a.path.localeCompare(b.path)
    );

    results.push({
      id: declared?.id,
      // Display name is always derived from the namespace. There's no
      // authored override, the namespace is the canonical identity.
      name: capitalize(humanizeStatePath(namespace)),
      namespace,
      description: declared?.description,
      resourceId: declared?.resourceId,
      fields,
      isMaterialized: declared !== undefined,
      usedBySurfaces: acc ? Array.from(acc.surfaces).sort() : []
    });
  }
  results.sort((a, b) => a.namespace.localeCompare(b.namespace));
  return results;
};

/**
 * Promote an effective data entry into a stored `Entity` record. Used when the
 * user wants to attach metadata (description, resource link, …). The resulting
 * `Entity` carries every effective field exactly as displayed.
 */
export const materializeFields = (
  effective: EffectiveEntities,
  newFieldId: () => EntityFieldId
): readonly EntityField[] => {
  return effective.fields.map((f) => ({
    id: f.id ?? newFieldId(),
    name: f.name,
    path: f.path,
    type: f.type,
    fields: f.fields,
    items: f.items
  }));
};
