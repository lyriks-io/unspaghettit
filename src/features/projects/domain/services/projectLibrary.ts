import type { Entity } from '$features/behavior-model/domain/entities/Entity';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Persona } from '$features/behavior-model/domain/entities/Persona';
import type { Resource } from '$features/behavior-model/domain/entities/Resource';
import type {
  EntityId,
  PersonaId,
  ResourceId
} from '$features/behavior-model/domain/value-objects/ids';
import type { Project } from '../entities/Project';

/**
 * REFERENCE-OVER-COPY for the project's canonical library.
 *
 * A feature must be verifiable in isolation, so every consumer downstream of
 * the repository reads `feature.entities` / `.resources` / `.personas`
 * directly. Modeling one domain object across N features therefore meant N
 * copies, which drift and double-count.
 *
 * The fix keeps both properties by moving the seam to the repository boundary:
 *
 *   load:  project library + feature.entityRefs  →  feature.entities (resolved)
 *   save:  feature.entities (resolved)           →  project library + refs
 *
 * so downstream code never learns that references exist, and the definition is
 * still stored exactly once. This module is the pure half of that; the
 * decorator that applies it is `ProjectScopedFeatureRepository`.
 *
 * Precedent, and the difference: `stateVariables` already gives a state PATH a
 * project-scoped canonical identity, but a StateDefinition still carries its
 * own local `path` / `type` / `defaultValue` — the id is a back-link, not a
 * substitute for the definition. Here the reference genuinely REPLACES the
 * stored definition, which is why resolution has to happen at the boundary
 * rather than being something each consumer opts into.
 */

/** The three kinds of definition the project library can hold. */
export type LibraryKind = 'entity' | 'resource' | 'persona';

export const ALL_LIBRARY_KINDS: readonly LibraryKind[] = ['entity', 'resource', 'persona'];

const byId = <T extends { readonly id: string }>(
  values: readonly T[] | undefined
): ReadonlyMap<string, T> => new Map((values ?? []).map((value) => [String(value.id), value]));

const dedupe = (values: readonly string[]): readonly string[] => [...new Set(values)];

/**
 * Materialize the project-library definitions a feature references into its own
 * `entities` / `resources` / `personas`, exactly as if they had been authored
 * inline. Locally-authored entries win on an id clash (a feature that still
 * carries its own copy keeps it, so the migration can proceed one feature at a
 * time), and refs are appended in declaration order after the local entries.
 *
 * `project` may be null — an unassigned feature, or a caller without project
 * context. Then this is the identity function and any refs simply stay
 * unresolved, which `danglingLibraryRefs` reports and the validator surfaces.
 */
export const resolveLibraryRefs = (feature: Feature, project: Project | null): Feature => {
  if (!project) return feature;
  const entityRefs = feature.entityRefs ?? [];
  const resourceRefs = feature.resourceRefs ?? [];
  const personaRefs = feature.personaRefs ?? [];
  if (entityRefs.length === 0 && resourceRefs.length === 0 && personaRefs.length === 0) {
    return feature;
  }

  const resolve = <T extends { readonly id: string }>(
    local: readonly T[],
    refs: readonly string[],
    library: readonly T[] | undefined
  ): readonly T[] => {
    if (refs.length === 0) return local;
    const catalog = byId(library);
    const seen = new Set(local.map((value) => String(value.id)));
    const out = [...local];
    for (const ref of dedupe(refs.map(String))) {
      if (seen.has(ref)) continue;
      const found = catalog.get(ref);
      if (!found) continue; // dangling — reported, never silently invented
      seen.add(ref);
      out.push(found);
    }
    return out;
  };

  return {
    ...feature,
    entities: resolve(feature.entities, entityRefs.map(String), project.entities),
    resources: resolve(feature.resources, resourceRefs.map(String), project.resources),
    personas: resolve(feature.personas, personaRefs.map(String), project.personas)
  };
};

/**
 * The inverse: drop every definition that came from the project library so the
 * feature snapshot stores refs, not copies.
 *
 * Write-back is deliberate. Because resolution is transparent, an ordinary
 * `update_entity` / `add_entity_field` edits the RESOLVED copy; without
 * write-back that edit would be silently discarded on save. Instead the changed
 * definition is pushed back into the project library, which is what "canonical"
 * means: editing a referenced entity from any member feature updates it for
 * every feature that references it.
 *
 * Returns the stripped feature plus the (possibly updated) project, or
 * `project: null` when the library is unchanged so the caller can skip a write.
 */
export const stripLibraryRefs = (
  feature: Feature,
  project: Project | null
): { readonly feature: Feature; readonly project: Project | null } => {
  if (!project) return { feature, project: null };
  const entityRefs = new Set((feature.entityRefs ?? []).map(String));
  const resourceRefs = new Set((feature.resourceRefs ?? []).map(String));
  const personaRefs = new Set((feature.personaRefs ?? []).map(String));
  if (entityRefs.size === 0 && resourceRefs.size === 0 && personaRefs.size === 0) {
    return { feature, project: null };
  }

  let libraryChanged = false;
  const split = <T extends { readonly id: string }>(
    resolved: readonly T[],
    refs: ReadonlySet<string>,
    library: readonly T[] | undefined
  ): { readonly local: readonly T[]; readonly library: readonly T[] | undefined } => {
    if (refs.size === 0) return { local: resolved, library };
    const local: T[] = [];
    const catalog = new Map((library ?? []).map((value) => [String(value.id), value]));
    for (const value of resolved) {
      const id = String(value.id);
      if (!refs.has(id)) {
        local.push(value);
        continue;
      }
      const canonical = catalog.get(id);
      // Edited through a member feature → push the change back to the library.
      if (canonical !== undefined && JSON.stringify(canonical) !== JSON.stringify(value)) {
        catalog.set(id, value);
        libraryChanged = true;
      }
    }
    return {
      local,
      library: libraryChanged ? [...catalog.values()] : library
    };
  };

  const entities = split(feature.entities, entityRefs, project.entities);
  const resources = split(feature.resources, resourceRefs, project.resources);
  const personas = split(feature.personas, personaRefs, project.personas);

  return {
    feature: {
      ...feature,
      entities: entities.local,
      resources: resources.local,
      personas: personas.local
    },
    project: libraryChanged
      ? {
          ...project,
          ...(entities.library ? { entities: entities.library } : {}),
          ...(resources.library ? { resources: resources.library } : {}),
          ...(personas.library ? { personas: personas.library } : {})
        }
      : null
  };
};

export type DanglingLibraryRef = {
  readonly kind: LibraryKind;
  readonly id: string;
};

/**
 * Refs a feature declares that the project library cannot satisfy. Passing
 * `project: null` reports every ref as dangling, which is the honest answer for
 * a feature that isn't in a project: there is no library to resolve against.
 */
export const danglingLibraryRefs = (
  feature: Feature,
  project: Project | null
): readonly DanglingLibraryRef[] => {
  const out: DanglingLibraryRef[] = [];
  const check = (
    kind: LibraryKind,
    refs: readonly string[] | undefined,
    library: readonly { readonly id: string }[] | undefined
  ): void => {
    if (!refs || refs.length === 0) return;
    const known = byId(library);
    for (const ref of dedupe(refs.map(String))) {
      if (!known.has(ref)) out.push({ kind, id: ref });
    }
  };
  check('entity', feature.entityRefs?.map(String), project?.entities);
  check('resource', feature.resourceRefs?.map(String), project?.resources);
  check('persona', feature.personaRefs?.map(String), project?.personas);
  return out;
};

// ─── Library transforms ────────────────────────────────────────────────────────
// Pure add/update/remove over the project library, mirroring the shape of
// `stateRegistry`'s registry transforms so the dashboard panel and the MCP
// tools share one implementation.

const upsert = <T extends { readonly id: string }>(
  values: readonly T[] | undefined,
  value: T
): readonly T[] => {
  const existing = values ?? [];
  return existing.some((v) => String(v.id) === String(value.id))
    ? existing.map((v) => (String(v.id) === String(value.id) ? value : v))
    : [...existing, value];
};

export const putLibraryEntity = (project: Project, entity: Entity): Project => ({
  ...project,
  entities: upsert(project.entities, entity)
});

export const putLibraryResource = (project: Project, resource: Resource): Project => ({
  ...project,
  resources: upsert(project.resources, resource)
});

export const putLibraryPersona = (project: Project, persona: Persona): Project => ({
  ...project,
  personas: upsert(project.personas, persona)
});

/**
 * Drop a canonical definition. Member features keep their now-dangling ref
 * rather than being rewritten: removal is a single-file edit, and the dangling
 * ref is a loud, per-feature validation error pointing at what to fix. Silently
 * rewriting N features from a project-level delete is the kind of invisible
 * cascade this whole design exists to avoid.
 */
export const removeFromLibrary = (project: Project, kind: LibraryKind, id: string): Project => {
  const drop = <T extends { readonly id: string }>(
    values: readonly T[] | undefined
  ): readonly T[] => (values ?? []).filter((value) => String(value.id) !== id);
  switch (kind) {
    case 'entity':
      return { ...project, entities: drop(project.entities) };
    case 'resource':
      return { ...project, resources: drop(project.resources) };
    case 'persona':
      return { ...project, personas: drop(project.personas) };
  }
};

/** Add a library reference to a feature, idempotently. */
export const linkLibraryRef = (feature: Feature, kind: LibraryKind, id: string): Feature => {
  const add = (refs: readonly string[] | undefined): readonly string[] =>
    (refs ?? []).map(String).includes(id) ? (refs ?? []).map(String) : [...(refs ?? []).map(String), id];
  switch (kind) {
    case 'entity':
      return { ...feature, entityRefs: add(feature.entityRefs?.map(String)) as readonly EntityId[] };
    case 'resource':
      return {
        ...feature,
        resourceRefs: add(feature.resourceRefs?.map(String)) as readonly ResourceId[]
      };
    case 'persona':
      return {
        ...feature,
        personaRefs: add(feature.personaRefs?.map(String)) as readonly PersonaId[]
      };
  }
};

/**
 * Remove a library reference. Also drops the resolved copy from the feature's
 * own array, so unlinking an in-memory (resolved) feature doesn't accidentally
 * turn the reference back into an inline copy on the next save.
 */
export const unlinkLibraryRef = (feature: Feature, kind: LibraryKind, id: string): Feature => {
  const without = (refs: readonly string[] | undefined): readonly string[] =>
    (refs ?? []).map(String).filter((ref) => ref !== id);
  const drop = <T extends { readonly id: string }>(values: readonly T[]): readonly T[] =>
    values.filter((value) => String(value.id) !== id);
  switch (kind) {
    case 'entity':
      return {
        ...feature,
        entityRefs: without(feature.entityRefs?.map(String)) as readonly EntityId[],
        entities: drop(feature.entities)
      };
    case 'resource':
      return {
        ...feature,
        resourceRefs: without(feature.resourceRefs?.map(String)) as readonly ResourceId[],
        resources: drop(feature.resources)
      };
    case 'persona':
      return {
        ...feature,
        personaRefs: without(feature.personaRefs?.map(String)) as readonly PersonaId[],
        personas: drop(feature.personas)
      };
  }
};

/**
 * Find one definition in the project library, whatever kind it is. Used by the
 * MCP tools to validate a link before writing it.
 */
export const findInLibrary = (
  project: Project,
  kind: LibraryKind,
  id: string
): { readonly id: string } | undefined => {
  const source =
    kind === 'entity'
      ? project.entities
      : kind === 'resource'
        ? project.resources
        : project.personas;
  return (source ?? []).find((value) => String(value.id) === id);
};
