import type { EntityField } from '../entities/Entity';
import type { Feature } from '../entities/Feature';

const declaredPaths = (feature: Feature): Set<string> => {
  const paths = new Set<string>();
  for (const surface of feature.surfaces) {
    for (const definition of surface.stateDefinitions) paths.add(String(definition.path));
  }
  return paths;
};

const fieldsWithPath = (
  fields: readonly EntityField[],
  out: { readonly field: EntityField }[] = []
): { readonly field: EntityField }[] => {
  for (const field of fields) {
    if (field.path !== undefined) out.push({ field });
    if (field.fields) fieldsWithPath(field.fields, out);
    if (field.items) fieldsWithPath([field.items], out);
  }
  return out;
};

/**
 * The entity fields a change left documenting a state path the feature
 * declared before it and no longer declares: a rename or a removal of the
 * state. Nothing refuses such a change (the data model may be the one about to
 * follow), so the answer names each field and the way to bring it along.
 */
export const entityFieldPathWarnings = (before: Feature, after: Feature): string[] => {
  const had = declaredPaths(before);
  const has = declaredPaths(after);
  const warnings: string[] = [];
  for (const entity of after.entities) {
    for (const { field } of fieldsWithPath(entity.fields)) {
      const path = String(field.path);
      if (!had.has(path) || has.has(path)) continue;
      warnings.push(
        `Entity "${entity.namespace}" field "${field.name}" (${String(field.id)}) still maps the state "${path}", which the feature no longer declares. Point it at the state's new path, or clear it, with update_entity_field.`
      );
    }
  }
  return warnings;
};
