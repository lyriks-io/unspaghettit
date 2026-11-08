import { z } from 'zod';
import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import type { Invariant } from '../../src/features/behavior-model/domain/entities/Invariant';
import {
  asEntityFieldId,
  asEntityId,
  asFeatureId,
  asSurfaceId,
  asValueSetId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import {
  flattenLeafConditions,
  isParamLeft,
  type RuleCondition
} from '../../src/features/behavior-model/domain/value-objects/RuleCondition';
import { CLOCK_NOW_PATH } from '../../src/features/behavior-model/domain/value-objects/SimulationClock';
import { asStatePath } from '../../src/features/behavior-model/domain/value-objects/StatePath';
import type { StateType } from '../../src/features/behavior-model/domain/value-objects/StateValue';
import { saveProjectUseCase } from '../../src/features/projects/application/use-cases/SaveProject';
import type { Project } from '../../src/features/projects/domain/entities/Project';
import type { StateVariable } from '../../src/features/projects/domain/entities/StateVariable';
import {
  declareCoreFeature,
  removeCoreFeature,
  updateCoreFeature
} from '../../src/features/projects/domain/services/coreFeatures';
import {
  projectStateVariables,
  stateCoherenceIssues
} from '../../src/features/projects/domain/services/stateRegistry';
import { asProjectId, asStateVariableId } from '../../src/features/projects/domain/value-objects/ids';
import { buildInvariant as buildInvariantBody } from './_entity_builders';
import { coerceScalarByType, errorText, text, type ToolDeps } from './_shared';
import { expandProjectId } from './short-ids';

type Op = Record<string, unknown> & { readonly kind: string };
type Projection = { readonly featureId: string; readonly surfaceId: string };
type BuilderBinding = NonNullable<NonNullable<StateVariable['links']>['builderBinding']>;

/** One element an add op created, keyed like apply_batch's `created`. */
export type ProjectCreated = { readonly op: number; readonly kind: string; readonly id: string };

export type ProjectBatchResult =
  | {
      readonly ok: true;
      readonly next: Project;
      readonly refs: Record<string, string>;
      readonly created: readonly ProjectCreated[];
      readonly warnings: readonly string[];
    }
  | { readonly ok: false; readonly errors: readonly string[] };

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

/** Every state path a leaf of the condition reads, on either side. */
const pathsRead = (condition: RuleCondition | undefined): { paths: string[]; params: string[] } => {
  const paths: string[] = [];
  const params: string[] = [];
  const walkRight = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (n.kind === 'state' && typeof n.path === 'string') paths.push(n.path);
    if (n.kind === 'param' && typeof n.name === 'string') params.push(n.name);
    for (const value of Object.values(n)) if (value && typeof value === 'object') walkRight(value);
  };
  for (const leaf of flattenLeafConditions(condition)) {
    if (isParamLeft(leaf.left)) params.push(leaf.left.name);
    else if (typeof leaf.left === 'string') paths.push(leaf.left);
    walkRight(leaf.right);
  }
  return { paths, params };
};

/** The state paths the member features declare: what a project invariant may read. */
const declaredPaths = (features: readonly Feature[]): Set<string> => {
  const paths = new Set<string>([CLOCK_NOW_PATH]);
  for (const feature of features) {
    for (const surface of feature.surfaces) {
      for (const def of surface.stateDefinitions) paths.add(String(def.path));
    }
  }
  return paths;
};

const projection = (value: unknown, label: string): { featureId: ReturnType<typeof asFeatureId>; surfaceId: ReturnType<typeof asSurfaceId> } => {
  const v = (value ?? {}) as Record<string, unknown>;
  const featureId = str(v.featureId);
  const surfaceId = str(v.surfaceId);
  if (!featureId || !surfaceId) throw new Error(`${label} needs { featureId, surfaceId }`);
  return { featureId: asFeatureId(featureId), surfaceId: asSurfaceId(surfaceId) };
};

const resolvesSurface = (features: readonly Feature[], p: Projection): boolean =>
  features.some((f) => String(f.id) === p.featureId && f.surfaces.some((s) => String(s.id) === p.surfaceId));

/**
 * Apply project-level operations to a project, atomically: every op runs on
 * the running project, then the result is validated as a whole, and nothing is
 * kept unless every op and every check passed. Pure: the caller saves.
 */
export const applyProjectOps = (
  start: Project,
  features: readonly Feature[],
  ops: readonly Op[],
  mintId: () => string
): ProjectBatchResult => {
  let project = start;
  const refs: Record<string, string> = {};
  const created: ProjectCreated[] = [];
  const idOf = (op: Op, idKey: string, refKey: string): string => {
    const ref = str(op[refKey]);
    if (ref) {
      const id = refs[ref];
      if (!id) throw new Error(`unknown ${refKey} "${ref}": no earlier op of this batch set it`);
      return id;
    }
    const id = str(op[idKey]);
    if (!id) throw new Error(`${idKey} or ${refKey} is required`);
    return id;
  };
  const remember = (op: Op, index: number, kind: string, id: string) => {
    const ref = str(op.ref);
    if (ref) refs[ref] = id;
    created.push({ op: index, kind, id });
  };
  const invariants = () => project.projectInvariants ?? [];
  const states = () => project.stateVariables ?? [];

  for (const [index, raw] of ops.entries()) {
    const op = (raw.patch && typeof raw.patch === 'object' ? { ...raw, ...(raw.patch as object) } : raw) as Op;
    try {
      switch (op.kind) {
        case 'add_project_invariant': {
          const body = (op.invariant ?? op) as Record<string, unknown>;
          const built = buildInvariantBody(body, mintId);
          project = { ...project, projectInvariants: [...invariants(), built] };
          remember(op, index, 'project_invariant', String(built.id));
          break;
        }
        case 'update_project_invariant': {
          const id = idOf(op, 'invariantId', 'invariantRef');
          if (!invariants().some((i) => String(i.id) === id)) throw new Error(`project invariant ${id} not found`);
          const fields = Object.fromEntries(
            ['name', 'condition', 'message', 'description']
              .filter((k) => op[k] !== undefined)
              .map((k) => [k, op[k]])
          );
          if (Object.keys(fields).length === 0) throw new Error('nothing to update: pass name, condition, message or description');
          project = {
            ...project,
            projectInvariants: invariants().map((i) => (String(i.id) === id ? ({ ...i, ...fields } as Invariant) : i))
          };
          break;
        }
        case 'remove_project_invariant': {
          const id = idOf(op, 'invariantId', 'invariantRef');
          if (!invariants().some((i) => String(i.id) === id)) throw new Error(`project invariant ${id} not found`);
          project = { ...project, projectInvariants: invariants().filter((i) => String(i.id) !== id) };
          break;
        }
        case 'declare_core_feature':
        case 'update_core_feature': {
          const value = str(op.value);
          const description = str(op.description);
          if (!value || !description) throw new Error('a core feature needs value and description');
          project =
            op.kind === 'declare_core_feature'
              ? declareCoreFeature(project, { value, description })
              : updateCoreFeature(project, value, { description });
          break;
        }
        case 'remove_core_feature': {
          const value = str(op.value);
          if (!value) throw new Error('value is required');
          project = removeCoreFeature(project, value);
          break;
        }
        case 'add_state_variable': {
          const path = str(op.path);
          const type = str(op.type) as StateType | undefined;
          const description = str(op.description);
          if (!path || !type || !description) throw new Error('a state variable needs path, type and description');
          const state: StateVariable = {
            id: asStateVariableId(mintId()),
            path: asStatePath(path),
            type,
            defaultValue: coerceScalarByType(op.defaultValue, type) as StateVariable['defaultValue'],
            description,
            ...(str(op.valueSetId) ? { valueSetId: asValueSetId(op.valueSetId as string) } : {}),
            ...(Array.isArray(op.enumValues) ? { enumValues: op.enumValues as string[] } : {}),
            owner: projection(op.owner, 'owner'),
            readers: (Array.isArray(op.readers) ? op.readers : []).map((p, i) => projection(p, `readers[${i}]`)),
            writers: (Array.isArray(op.writers) ? op.writers : []).map((p, i) => projection(p, `writers[${i}]`))
          };
          project = { ...project, stateVariables: [...states(), state] };
          remember(op, index, 'state_variable', String(state.id));
          break;
        }
        case 'update_state_variable': {
          const id = idOf(op, 'stateId', 'stateRef');
          const current = states().find((s) => String(s.id) === id);
          if (!current) throw new Error(`state variable ${id} not found`);
          const type = (str(op.type) as StateType | undefined) ?? current.type;
          const next: StateVariable = {
            ...current,
            ...(str(op.path) ? { path: asStatePath(op.path as string) } : {}),
            ...(str(op.type) ? { type } : {}),
            ...(op.defaultValue !== undefined
              ? { defaultValue: coerceScalarByType(op.defaultValue, type) as StateVariable['defaultValue'] }
              : {}),
            ...(str(op.description) ? { description: op.description as string } : {}),
            ...(op.valueSetId !== undefined
              ? { valueSetId: op.valueSetId === null ? undefined : asValueSetId(op.valueSetId as string) }
              : {}),
            ...(op.enumValues !== undefined ? { enumValues: (op.enumValues as string[] | null) ?? undefined } : {}),
            ...(op.owner ? { owner: projection(op.owner, 'owner') } : {}),
            ...(Array.isArray(op.readers) ? { readers: op.readers.map((p, i) => projection(p, `readers[${i}]`)) } : {}),
            ...(Array.isArray(op.writers) ? { writers: op.writers.map((p, i) => projection(p, `writers[${i}]`)) } : {})
          };
          project = { ...project, stateVariables: states().map((s) => (s === current ? next : s)) };
          break;
        }
        case 'link_state_variable': {
          const id = idOf(op, 'stateId', 'stateRef');
          const current = states().find((s) => String(s.id) === id);
          if (!current) throw new Error(`state variable ${id} not found`);
          const field = op.dataField as Record<string, unknown> | null | undefined;
          const links = {
            ...(current.links ?? {}),
            ...(field !== undefined
              ? {
                  dataField:
                    field === null
                      ? undefined
                      : {
                          featureId: asFeatureId(String(field.featureId)),
                          entityId: asEntityId(String(field.entityId)),
                          fieldId: asEntityFieldId(String(field.fieldId))
                        }
                }
              : {}),
            ...(op.builderBinding !== undefined
              ? { builderBinding: (op.builderBinding as BuilderBinding | null) ?? undefined }
              : {})
          };
          project = {
            ...project,
            stateVariables: states().map((s) => (s === current ? { ...current, links } : s))
          };
          break;
        }
        case 'remove_state_variable': {
          const id = idOf(op, 'stateId', 'stateRef');
          if (!states().some((s) => String(s.id) === id)) throw new Error(`state variable ${id} not found`);
          project = { ...project, stateVariables: states().filter((s) => String(s.id) !== id) };
          break;
        }
        default:
          throw new Error(
            `unknown project op kind "${op.kind}". One of: add/update/remove_project_invariant, add/update/remove_state_variable, link_state_variable, declare/update/remove_core_feature`
          );
      }
    } catch (e) {
      return { ok: false, errors: [`op[${index}] (${raw.kind}): ${(e as Error).message}`] };
    }
  }

  // Validate the project the batch leaves, as a whole.
  const errors: string[] = [];
  const known = declaredPaths(features);
  for (const invariant of project.projectInvariants ?? []) {
    const label = `Project invariant ${String(invariant.id)} ("${invariant.name}")`;
    if (!invariant.condition) {
      errors.push(`${label}: condition is required; an invariant is the property that must always hold.`);
      continue;
    }
    const { paths, params } = pathsRead(invariant.condition);
    for (const name of params) {
      errors.push(`${label}: reads parameter "${name}"; a project invariant has no parameter in scope, only state.`);
    }
    for (const path of paths) {
      if (!known.has(path) && !(project.stateVariables ?? []).some((s) => String(s.path) === path)) {
        errors.push(`${label}: reads state "${path}", which no feature of the project declares.`);
      }
    }
  }
  const seen = new Set<string>();
  for (const state of project.stateVariables ?? []) {
    const label = `State variable ${String(state.id)} ("${String(state.path)}")`;
    if (seen.has(String(state.path))) errors.push(`${label}: path is declared twice in the project.`);
    seen.add(String(state.path));
    if (state.valueSetId && state.enumValues) errors.push(`${label}: set either valueSetId or enumValues, not both.`);
    if (!resolvesSurface(features, { featureId: String(state.owner.featureId), surfaceId: String(state.owner.surfaceId) })) {
      errors.push(`${label}: owner ${String(state.owner.featureId)}/${String(state.owner.surfaceId)} is not a surface of a project feature.`);
    }
    for (const p of [...state.readers, ...state.writers]) {
      if (!resolvesSurface(features, { featureId: String(p.featureId), surfaceId: String(p.surfaceId) })) {
        errors.push(`${label}: projection ${String(p.featureId)}/${String(p.surfaceId)} is not a surface of a project feature.`);
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  // Drift between a canonical state and the data field it mirrors is reported,
  // never refused: the data model may be the one about to change.
  const warnings = stateCoherenceIssues(
    projectStateVariables(project, features),
    features,
    'en',
    project.projectInvariants ?? []
  ).map(
    (issue) => `${issue.path}: ${issue.message}`
  );
  return { ok: true, next: project, refs, created, warnings };
};

export const registerProjectBatchTool = ({ server, repo, projectRepo, clock, ids }: ToolDeps): void => {
  const saveProject = saveProjectUseCase({ repository: projectRepo, clock });
  server.registerTool(
    'apply_project_batch',
    {
      description:
        'The project-level counterpart of apply_batch: N ops on ONE project in a single atomic load + validate + save (nothing lands unless every op and every check passes; dryRun:true saves nothing). Ops: add_project_invariant { ref?, invariant: { name, condition, message, description } } (a safety property spanning features: its condition reads state paths declared by ANY feature of the project, never a parameter; a path no feature declares is refused), update_project_invariant { invariantId|invariantRef, name?, condition?, message?, description? }, remove_project_invariant { invariantId }; add_state_variable { ref?, path, type, defaultValue, description, valueSetId?|enumValues?, owner: { featureId, surfaceId }, readers?, writers? } (one canonical identity for a state several features share; the path is unique in the project and every projection must be a surface of a project feature), update_state_variable { stateId|stateRef, ...fields }, link_state_variable { stateId|stateRef, dataField?: { featureId, entityId, fieldId } | null, builderBinding? } (drift between the state and the field it mirrors comes back as `warnings`, never a refusal), remove_state_variable { stateId }; declare_core_feature { value, description }, update_core_feature { value, description }, remove_core_feature { value }. Answers { ok, dryRun, projectId, appliedCount, refs, created: [{ op, kind, id }], warnings, updatedAt } or { ok:false, errors } naming the op. Project invariants are enforced by verify and model_check over the union of the features\' state, and by simulate_steps on every step of a member feature.',
      inputSchema: {
        projectId: z.string(),
        operations: z.array(z.record(z.string(), z.unknown())).min(1),
        dryRun: z.boolean().optional()
      }
    },
    async ({ projectId, operations, dryRun }) => {
      try {
        projectId = await expandProjectId(projectRepo, projectId);
        const project = await projectRepo.get(asProjectId(projectId));
        if (!project) return errorText(`Project ${projectId} not found`);
        const features = (await Promise.all(project.featureIds.map((id) => repo.get(id)))).filter(
          (f): f is Feature => f !== null
        );
        const result = applyProjectOps(project, features, operations as Op[], ids);
        if (!result.ok) return text({ ok: false, dryRun: dryRun === true, projectId, errors: result.errors });
        const saved = dryRun ? result.next : await saveProject(result.next);
        return text({
          ok: true,
          dryRun: dryRun === true,
          projectId,
          appliedCount: operations.length,
          refs: result.refs,
          created: result.created,
          warnings: result.warnings,
          updatedAt: saved.updatedAt
        });
      } catch (e) {
        return errorText((e as Error).message);
      }
    }
  );
};
