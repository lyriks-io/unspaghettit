import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import type { FeatureRepository } from '$features/behavior-model/application/ports/FeatureRepository';
import type {
  ActionId,
  FeatureId,
  SurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { toSlug } from '$features/behavior-model/domain/value-objects/slug';
import type { Clock } from '$shared/domain/Clock';
import type { ImplementationStatusRepository } from '$features/implementation-status/application/ports/ImplementationStatusRepository';
import {
  emptyImplementationStatus,
  upsertActionStatus,
  upsertSurfaceStatus,
  type AuditMeta,
  type ActionImplementationStatus,
  type EntityType,
  type ExpectedEntity,
  type ExtraTag,
  type FoundEntity,
  type ImplementationStatus,
  type MissingEntity,
  type SurfaceImplementationStatus,
  type TagLocation
} from '$features/implementation-status/domain/ImplementationStatus';

export class FeatureNotFoundForReportError extends Error {
  constructor(id: FeatureId) {
    super(`Feature ${id} not found`);
  }
}

export class ActionNotFoundForReportError extends Error {
  constructor(id: ActionId, featureId: FeatureId) {
    super(`Action ${id} not found in feature ${featureId}`);
  }
}

export class SurfaceNotFoundForReportError extends Error {
  constructor(id: SurfaceId, featureId: FeatureId) {
    super(`Surface ${id} not found in feature ${featureId}`);
  }
}

export type ReportEntityInput = {
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly locations: readonly TagLocation[];
  readonly capturedFields?: unknown;
};

export type ReportImplementationStatusInput = {
  readonly featureId: FeatureId;
  /** Exactly one of actionId / surfaceId must be set. */
  readonly actionId?: ActionId;
  readonly surfaceId?: SurfaceId;
  readonly foundEntities: readonly ReportEntityInput[];
  readonly extraTags?: readonly ExtraTag[];
  /** Audit metadata read from the behavioral index (.unspa.json). Stored alongside the report for dashboard display. */
  readonly auditMeta?: AuditMeta;
};

export type ReportImplementationStatusOutput = {
  readonly featureId: FeatureId;
  readonly revision: number;
  readonly updatedAt: string;
  readonly scope: 'action' | 'surface';
  readonly slug: string;
  readonly missingEntities: readonly MissingEntity[];
  readonly foundEntities: readonly FoundEntity[];
};

const findCapability = (exp: Feature, actionId: ActionId) => {
  for (const surface of exp.surfaces) {
    const cap = surface.actions.find((c) => c.id === actionId);
    if (cap) return { surface, action: cap };
  }
  return null;
};

const findSurface = (exp: Feature, surfaceId: SurfaceId): Surface | null =>
  exp.surfaces.find((s) => s.id === surfaceId) ?? null;

/**
 * Build the spec-side list of entities the audit cares about for this
 * action: the action itself + each emitted event + each rule +
 * invariant + transition attached to it. Mirrors `auditImplementationTool`'s
 * tag policy so the LLM never has to invent tag formats.
 */
/**
 * Slugify a free-form description for use inside an audit tag, keeping it short
 * enough to skim. Falls back to `fallback` when the text is empty or yields no
 * usable slug. `seen` tracks slugs already minted in the current scope so we
 * append `-2`, `-3`, ... when descriptions collide.
 */
const slugForAuditTag = (
  text: string | undefined,
  fallback: string,
  seen: Set<string>,
  maxWords = 4
): string => {
  const words = (text ?? '').trim().split(/\s+/).filter(Boolean).slice(0, maxWords).join(' ');
  let candidate = toSlug(words);
  if (!candidate) candidate = fallback;
  if (!seen.has(candidate)) {
    seen.add(candidate);
    return candidate;
  }
  let n = 2;
  while (seen.has(`${candidate}-${n}`)) n += 1;
  const result = `${candidate}-${n}`;
  seen.add(result);
  return result;
};

const buildExpectedCapabilityEntities = (
  action: Action,
  actionSlug: string
): ExpectedEntity[] => {
  const out: ExpectedEntity[] = [];
  const ruleSlugs = new Set<string>();
  const invSlugs = new Set<string>();
  const transSlugs = new Set<string>();
  out.push({
    entityType: 'action',
    entityId: String(action.id),
    entityName: action.name,
    tag: `@unspa:action:${actionSlug}`
  });
  for (const event of action.emittedEvents) {
    const e = String(event);
    out.push({
      entityType: 'event',
      entityId: e,
      entityName: e,
      tag: `@unspa:${actionSlug}#${e}`
    });
  }
  for (const rule of action.rules) {
    const slug = slugForAuditTag(rule.description, String(rule.id), ruleSlugs);
    out.push({
      entityType: 'rule',
      entityId: String(rule.id),
      entityName: rule.description,
      tag: `@unspa:rule:${slug}`
    });
  }
  for (const inv of action.invariants) {
    const slug = slugForAuditTag(inv.name, String(inv.id), invSlugs);
    out.push({
      entityType: 'invariant',
      entityId: String(inv.id),
      entityName: inv.name,
      tag: `@unspa:invariant:${slug}`
    });
  }
  for (const t of action.transitions) {
    const slug = slugForAuditTag(t.label, String(t.id), transSlugs);
    out.push({
      entityType: 'transition',
      entityId: String(t.id),
      entityName: t.label,
      tag: `@unspa:transition:${slug}`
    });
  }
  return out;
};

/**
 * Surface-scoped expected entities. Covers what doesn't belong to a single
 * action: state definitions, data namespaces, surface-level rules and
 * invariants. Tag formats follow the same `@unspa:<type>:<id-or-slug>`
 * policy as action-scoped entities.
 */
const buildExpectedSurfaceEntities = (surface: Surface): ExpectedEntity[] => {
  const out: ExpectedEntity[] = [];
  const ruleSlugs = new Set<string>();
  const invSlugs = new Set<string>();
  for (const sd of surface.stateDefinitions) {
    const path = String(sd.path);
    out.push({
      entityType: 'state',
      entityId: String(sd.id),
      entityName: path,
      tag: `@unspa:state:${path}`
    });
  }
  for (const r of surface.rules) {
    const slug = slugForAuditTag(r.description, String(r.id), ruleSlugs);
    out.push({
      entityType: 'surface_rule',
      entityId: String(r.id),
      entityName: r.description,
      tag: `@unspa:surface_rule:${slug}`
    });
  }
  for (const inv of surface.invariants) {
    const slug = slugForAuditTag(inv.name, String(inv.id), invSlugs);
    out.push({
      entityType: 'surface_invariant',
      entityId: String(inv.id),
      entityName: inv.name,
      tag: `@unspa:surface_invariant:${slug}`
    });
  }
  return out;
};

const keyOf = (entityType: EntityType, entityId: string): string =>
  `${entityType}:${entityId}`;

const reconcile = (
  expected: readonly ExpectedEntity[],
  reportedFound: readonly ReportEntityInput[],
  extraTagsInput: readonly ExtraTag[],
  now: string
) => {
  const expectedByKey = new Map(expected.map((e) => [keyOf(e.entityType, e.entityId), e]));
  const reportedByKey = new Map<string, ReportEntityInput>();
  for (const r of reportedFound) reportedByKey.set(keyOf(r.entityType, r.entityId), r);

  const foundEntities: FoundEntity[] = [];
  for (const e of expected) {
    const reported = reportedByKey.get(keyOf(e.entityType, e.entityId));
    if (!reported) continue;
    const base: FoundEntity = {
      entityType: e.entityType,
      entityId: e.entityId,
      entityName: e.entityName,
      tag: e.tag,
      locations: reported.locations,
      capturedAt: now
    };
    foundEntities.push(
      reported.capturedFields !== undefined
        ? { ...base, capturedFields: reported.capturedFields }
        : base
    );
  }

  const missingEntities: MissingEntity[] = expected
    .filter((e) => !reportedByKey.has(keyOf(e.entityType, e.entityId)))
    .map((e) => ({
      entityType: e.entityType,
      entityId: e.entityId,
      entityName: e.entityName,
      tag: e.tag
    }));

  const reportedExtras: ExtraTag[] = [];
  for (const [k, reported] of reportedByKey) {
    if (expectedByKey.has(k)) continue;
    const tag = `@unspa:${reported.entityType}:${reported.entityId}`;
    reportedExtras.push({ tag, locations: reported.locations });
  }
  const extraTags: ExtraTag[] = [...extraTagsInput, ...reportedExtras];

  return { foundEntities, missingEntities, extraTags };
};

export const reportImplementationStatusUseCase =
  (deps: {
    readonly features: FeatureRepository;
    readonly statuses: ImplementationStatusRepository;
    readonly clock: Clock;
  }) =>
  async (
    input: ReportImplementationStatusInput
  ): Promise<ReportImplementationStatusOutput> => {
    const exp = await deps.features.get(input.featureId);
    if (!exp) throw new FeatureNotFoundForReportError(input.featureId);

    const now = deps.clock();
    const previous: ImplementationStatus =
      (await deps.statuses.get(input.featureId)) ??
      emptyImplementationStatus(input.featureId, now);

    if (input.actionId) {
      const located = findCapability(exp, input.actionId);
      if (!located)
        throw new ActionNotFoundForReportError(input.actionId, input.featureId);
      const { surface, action } = located;
      const slug = toSlug(action.name) || String(action.id);
      const expectedEntities = buildExpectedCapabilityEntities(action, slug);
      const { foundEntities, missingEntities, extraTags } = reconcile(
        expectedEntities,
        input.foundEntities,
        input.extraTags ?? [],
        now
      );

      const actionStatus: ActionImplementationStatus = {
        actionId: action.id,
        actionSlug: slug,
        actionName: action.name,
        surfaceId: surface.id,
        expectedEntities,
        foundEntities,
        missingEntities,
        extraTags,
        reportedAt: now,
        ...(input.auditMeta !== undefined ? { auditMeta: input.auditMeta } : {})
      };
      const next = upsertActionStatus(previous, actionStatus, now);
      await deps.statuses.save(next);

      return {
        featureId: input.featureId,
        revision: next.revision,
        updatedAt: next.updatedAt,
        scope: 'action',
        slug,
        missingEntities,
        foundEntities
      };
    }

    if (input.surfaceId) {
      const surface = findSurface(exp, input.surfaceId);
      if (!surface)
        throw new SurfaceNotFoundForReportError(input.surfaceId, input.featureId);
      const slug = toSlug(surface.name) || String(surface.id);
      const expectedEntities = buildExpectedSurfaceEntities(surface);
      const { foundEntities, missingEntities, extraTags } = reconcile(
        expectedEntities,
        input.foundEntities,
        input.extraTags ?? [],
        now
      );

      const surfaceStatus: SurfaceImplementationStatus = {
        surfaceId: surface.id,
        surfaceSlug: slug,
        surfaceName: surface.name,
        expectedEntities,
        foundEntities,
        missingEntities,
        extraTags,
        reportedAt: now,
        ...(input.auditMeta !== undefined ? { auditMeta: input.auditMeta } : {})
      };
      const next = upsertSurfaceStatus(previous, surfaceStatus, now);
      await deps.statuses.save(next);

      return {
        featureId: input.featureId,
        revision: next.revision,
        updatedAt: next.updatedAt,
        scope: 'surface',
        slug,
        missingEntities,
        foundEntities
      };
    }

    throw new Error(
      'report_implementation_status requires either actionId or surfaceId'
    );
  };
