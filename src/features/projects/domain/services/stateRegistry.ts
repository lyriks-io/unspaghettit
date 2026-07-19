import type { EntityField } from '$features/behavior-model/domain/entities/Entity';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { ValueSetId } from '$features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import type { Project } from '../entities/Project';
import type { StateVariable, StateVariableProjection } from '../entities/StateVariable';
import { asStateVariableId } from '../value-objects/ids';

const projectionKey = (p: StateVariableProjection): string => `${p.featureId}:${p.surfaceId}`;

const uniqueProjections = (
  values: readonly StateVariableProjection[]
): readonly StateVariableProjection[] => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = projectionKey(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Read projection for old and new snapshots. Legacy state definitions are
 * grouped by path without rewriting the snapshot; explicit registry entries
 * win and collect any surface references carrying their stable id.
 */
export const projectStateVariables = (
  project: Project,
  features: readonly Feature[]
): readonly StateVariable[] => {
  const explicit = new Map(
    (project.stateVariables ?? []).map((state) => [String(state.id), state])
  );
  const explicitByPath = new Map(
    (project.stateVariables ?? []).map((state) => [String(state.path), state])
  );
  const referenced = new Map<string, StateVariableProjection[]>();
  const legacy = new Map<string, StateVariable>();

  for (const feature of features) {
    for (const surface of feature.surfaces) {
      for (const definition of surface.stateDefinitions) {
        const projection = { featureId: feature.id, surfaceId: surface.id };
        if (definition.stateVariableId && explicit.has(String(definition.stateVariableId))) {
          const id = String(definition.stateVariableId);
          referenced.set(id, [...(referenced.get(id) ?? []), projection]);
          continue;
        }
        const path = String(definition.path);
        const registered = explicitByPath.get(path);
        if (registered) {
          const id = String(registered.id);
          referenced.set(id, [...(referenced.get(id) ?? []), projection]);
          continue;
        }
        const existing = legacy.get(path);
        if (existing) {
          legacy.set(path, {
            ...existing,
            readers: uniqueProjections([
              ...existing.readers,
              projection,
              ...(definition.sharedWith ?? []).map((surfaceId) => ({
                featureId: feature.id,
                surfaceId
              }))
            ])
          });
          continue;
        }
        legacy.set(path, {
          id: asStateVariableId(String(definition.id)),
          path: asStatePath(path),
          type: definition.type,
          defaultValue: definition.defaultValue,
          description: definition.description ?? `State at ${path}`,
          ...(definition.valueSetId ? { valueSetId: definition.valueSetId } : {}),
          ...(definition.enumValues ? { enumValues: definition.enumValues } : {}),
          owner: projection,
          readers: (definition.sharedWith ?? []).map((surfaceId) => ({
            featureId: feature.id,
            surfaceId
          })),
          writers: []
        });
      }
    }
  }

  const registered = (project.stateVariables ?? []).map((state) => ({
    ...state,
    readers: uniqueProjections([...state.readers, ...(referenced.get(String(state.id)) ?? [])]),
    writers: uniqueProjections(state.writers)
  }));
  return [...registered, ...legacy.values()];
};

// ─── Registry transforms ───────────────────────────────────────────────────────
// Pure add/update/remove over `project.stateVariables`, mirroring the MCP
// `add/update/remove_state_variable` tools so the dashboard authoring panel and
// the LLM share one canonical registry. The caller mints the id and builds the
// entry (owner/path/type/default); these transforms only splice the array.

/** Append a freshly-minted canonical state variable to the project registry. */
export const declareStateVariable = (project: Project, state: StateVariable): Project => ({
  ...project,
  stateVariables: [...(project.stateVariables ?? []), state]
});

/** Patch a registered state variable by id (the stable id itself is immutable). */
export const updateStateVariable = (
  project: Project,
  id: string,
  patch: Partial<Omit<StateVariable, 'id'>>
): Project => ({
  ...project,
  stateVariables: (project.stateVariables ?? []).map((state) =>
    String(state.id) === id ? { ...state, ...patch } : state
  )
});

/**
 * Remove a registered canonical identity. Surface projections keep their
 * `stateVariableId` back-ref, which simply stops resolving (the projection
 * falls back to legacy path-grouping) — removal never rewrites features.
 */
export const removeStateVariable = (project: Project, id: string): Project => ({
  ...project,
  stateVariables: (project.stateVariables ?? []).filter((state) => String(state.id) !== id)
});

export type StateCoherenceIssue = {
  readonly severity: 'error' | 'warning';
  readonly stateId: string;
  readonly path: string;
  readonly kind: 'missing-data-field' | 'field-type-mismatch' | 'field-enum-mismatch';
  readonly message: string;
};

const findField = (fields: readonly EntityField[], id: string): EntityField | undefined => {
  for (const field of fields) {
    if (String(field.id) === id) return field;
    const nested = field.fields ? findField(field.fields, id) : undefined;
    if (nested) return nested;
    if (field.items) {
      const item = findField([field.items], id);
      if (item) return item;
    }
  }
  return undefined;
};

const valuesFor = (features: readonly Feature[], id: ValueSetId | undefined) => {
  if (!id) return undefined;
  for (const feature of features) {
    const values = (feature.valueSets ?? []).find((set) => set.id === id)?.values;
    if (values) return values;
  }
  return undefined;
};

const sameValues = (left: readonly string[] | undefined, right: readonly string[] | undefined) =>
  left !== undefined &&
  right !== undefined &&
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

export const stateCoherenceIssues = (
  states: readonly StateVariable[],
  features: readonly Feature[]
): readonly StateCoherenceIssue[] => {
  const issues: StateCoherenceIssue[] = [];
  for (const state of states) {
    const link = state.links?.dataField;
    if (!link) continue;
    const feature = features.find((item) => item.id === link.featureId);
    const entity = feature?.entities.find((item) => item.id === link.entityId);
    const field = entity ? findField(entity.fields, String(link.fieldId)) : undefined;
    if (!field) {
      issues.push({
        severity: 'error',
        stateId: String(state.id),
        path: String(state.path),
        kind: 'missing-data-field',
        message: `Linked data field ${link.featureId}/${link.entityId}/${link.fieldId} does not exist.`
      });
      continue;
    }
    if (field.type !== state.type) {
      issues.push({
        severity: 'error',
        stateId: String(state.id),
        path: String(state.path),
        kind: 'field-type-mismatch',
        message: `Linked field type "${field.type}" differs from state type "${state.type}".`
      });
    }
    if (state.type === 'enum') {
      const stateValues = state.enumValues ?? valuesFor(features, state.valueSetId);
      const fieldValues = field.enumValues ?? valuesFor(features, field.valueSetId);
      if (!sameValues(stateValues, fieldValues)) {
        issues.push({
          severity: 'error',
          stateId: String(state.id),
          path: String(state.path),
          kind: 'field-enum-mismatch',
          message: 'Linked field enum values differ from the canonical state value set.'
        });
      }
    }
  }
  return issues;
};
