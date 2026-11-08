import type { EntityField } from '$features/behavior-model/domain/entities/Entity';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
import type { ValueSetId } from '$features/behavior-model/domain/value-objects/ids';
import { asStatePath, isStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import type { Project } from '../entities/Project';
import type { StateVariable, StateVariableProjection } from '../entities/StateVariable';
import { asStateVariableId } from '../value-objects/ids';
import { quoteName, type ReportLanguage } from '$shared/language';

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
        // A path that is not a state path cannot be a canonical state; the
        // feature holding it reports it in its own gaps, and one bad state
        // never stops the reading of the whole project.
        if (!isStatePath(path)) continue;
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
  readonly kind:
    | 'missing-data-field'
    | 'field-type-mismatch'
    | 'field-enum-mismatch'
    | 'declaration-type-mismatch'
    | 'declaration-choices-mismatch';
  readonly message: string;
  /** Every feature the issue involves, so each of them reports it (a declaration disagreement). */
  readonly featureIds?: readonly string[];
};

/** Every state path a condition reads: the left of each comparison and any state it compares to. */
const pathsReadBy = (condition: unknown): string[] => {
  const out: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as { [key: string]: unknown };
    if (typeof node.left === 'string' && 'operator' in node) out.push(node.left);
    if (node.kind === 'state' && typeof node.path === 'string') out.push(node.path);
    if (typeof node.overPath === 'string') out.push(node.overPath);
    for (const child of Object.values(node)) if (child && typeof child === 'object') visit(child);
  };
  visit(condition);
  return out;
};

type Declaration = {
  readonly featureId: string;
  readonly featureName: string;
  readonly type: string;
  readonly values: readonly string[] | undefined;
};

/**
 * Where two features of a project declare one state path differently. A path
 * is one variable for the whole project, so a disagreement on its kind of value
 * makes every proof about it depend on which declaration was read first: an
 * error. A disagreement on the values a choice allows is an error when a
 * project invariant reads the path (the proofs across features then rest on
 * it), a warning otherwise (each feature may be using the path on its own).
 * Different starting values are never reported: every engine starts a feature
 * from its own (startingDeclarations).
 */
export const stateDeclarationIssues = (
  features: readonly Feature[],
  projectInvariants: readonly Invariant[] = [],
  language: ReportLanguage = 'en'
): StateCoherenceIssue[] => {
  const readByProject = new Set(projectInvariants.flatMap((invariant) => pathsReadBy(invariant.condition)));
  const fr = language === 'fr';
  const byPath = new Map<string, { id: string; declarations: Declaration[] }>();
  for (const feature of features) {
    const seen = new Set<string>();
    for (const surface of feature.surfaces) {
      for (const definition of surface.stateDefinitions) {
        const path = String(definition.path);
        if (!isStatePath(path) || seen.has(path)) continue;
        seen.add(path);
        const entry = byPath.get(path) ?? { id: String(definition.id), declarations: [] };
        entry.declarations.push({
          featureId: String(feature.id),
          featureName: feature.name,
          type: definition.type,
          values:
            definition.type === 'enum'
              ? (definition.enumValues ?? valuesFor(features, definition.valueSetId))
              : undefined
        });
        byPath.set(path, entry);
      }
    }
  }
  const issues: StateCoherenceIssue[] = [];
  const sameSet = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
    a !== undefined && b !== undefined && a.length === b.length && a.every((v) => b.includes(v));
  const list = (declarations: readonly Declaration[], show: (d: Declaration) => string) =>
    declarations
      .map((d) => (fr ? `${quoteName('fr', d.featureName)} (${show(d)})` : `"${d.featureName}" (${show(d)})`))
      .join(fr ? ', ' : ', ');
  for (const [path, { id, declarations }] of byPath) {
    if (declarations.length < 2) continue;
    const featureIds = declarations.map((d) => d.featureId);
    const quoted = fr ? quoteName('fr', path) : `"${path}"`;
    if (new Set(declarations.map((d) => d.type)).size > 1) {
      issues.push({
        severity: 'error',
        stateId: id,
        path,
        kind: 'declaration-type-mismatch',
        featureIds,
        message: fr
          ? `L'état ${quoted} est déclaré avec des types différents : ${list(declarations, (d) => d.type)}. Un chemin est une seule variable pour tout le projet, donc chaque preuve qui le lit dépend de la déclaration lue en premier.`
          : `State ${quoted} is declared with different kinds of value: ${list(declarations, (d) => d.type)}. A path is one variable for the whole project, so every proof that reads it depends on which declaration was read first.`
      });
      continue;
    }
    if (declarations[0]!.type !== 'enum') continue;
    const first = declarations[0]!.values;
    if (declarations.every((d) => sameSet(d.values, first))) continue;
    const shared = readByProject.has(path);
    issues.push({
      severity: shared ? 'error' : 'warning',
      stateId: id,
      path,
      kind: 'declaration-choices-mismatch',
      featureIds,
      message: fr
        ? `L'état ${quoted} n'autorise pas les mêmes valeurs selon la feature : ${list(declarations, (d) => (d.values ?? []).join(', '))}.${shared ? ' Un invariant du projet le lit, donc les preuves entre features reposent sur ce désaccord.' : ''}`
        : `State ${quoted} allows different values depending on the feature: ${list(declarations, (d) => (d.values ?? []).join(', '))}.${shared ? ' A project invariant reads it, so the proofs across features rest on this disagreement.' : ''}`
    });
  }
  return issues;
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

/**
 * Whether a state of one kind can carry a data field of another: the same kind,
 * or a date, a timestamp or a JSON document held as text (a JSON one also as
 * an object), the way a behaviour model writes them.
 */
const carries = (stateType: string, fieldType: string): boolean =>
  stateType === fieldType ||
  ((fieldType === 'date' || fieldType === 'timestamp') && stateType === 'string') ||
  (fieldType === 'json' && (stateType === 'string' || stateType === 'object'));

/**
 * Where a canonical state and the entity field it links to disagree. `message`
 * follows `language` (the spec's); ids, paths and types are quoted as they are.
 */
export const stateCoherenceIssues = (
  states: readonly StateVariable[],
  features: readonly Feature[],
  language: ReportLanguage = 'en',
  projectInvariants: readonly Invariant[] = []
): readonly StateCoherenceIssue[] => {
  const fr = language === 'fr';
  const issues: StateCoherenceIssue[] = [
    ...stateDeclarationIssues(features, projectInvariants, language)
  ];
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
        message: fr
          ? `Le champ de données lié ${link.featureId}/${link.entityId}/${link.fieldId} n'existe pas.`
          : `Linked data field ${link.featureId}/${link.entityId}/${link.fieldId} does not exist.`
      });
      continue;
    }
    if (!carries(state.type, field.type)) {
      issues.push({
        severity: 'error',
        stateId: String(state.id),
        path: String(state.path),
        kind: 'field-type-mismatch',
        message: fr
          ? `Le type du champ lié, ${quoteName('fr', field.type)}, diffère du type de l'état, ${quoteName('fr', state.type)}.`
          : `Linked field type "${field.type}" differs from state type "${state.type}".`
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
          message: fr
            ? "Les valeurs d'énumération du champ lié diffèrent de l'ensemble de valeurs de l'état canonique."
            : 'Linked field enum values differ from the canonical state value set.'
        });
      }
    }
  }
  return issues;
};
