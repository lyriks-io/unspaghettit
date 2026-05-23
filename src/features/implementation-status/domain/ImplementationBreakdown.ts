import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import { toSlug } from '$features/behavior-model/domain/value-objects/slug';
import type {
  ActionImplementationStatus,
  EntityType,
  ExpectedEntity,
  FoundEntity,
  ImplementationStatus,
  MissingEntity,
  SurfaceImplementationStatus
} from '$features/implementation-status/domain/ImplementationStatus';

/**
 * Breakdown computed by combining the feature spec (truth about what
 * entities should be tagged) with the sidecar status (what the LLM actually
 * found in the implementation repo). Mirrors the shape of MaturityBreakdown
 * so the UI can render a similar tree.
 */

export type CapabilityImplementationEntry = {
  readonly action: Action;
  readonly status: ActionImplementationStatus | null;
  readonly expected: readonly ExpectedEntity[];
  readonly found: readonly FoundEntity[];
  readonly missing: readonly MissingEntity[];
  readonly expectedCount: number;
  readonly foundCount: number;
  readonly missingCount: number;
  readonly extraCount: number;
  /** 100 when nothing is expected, otherwise found / expected. */
  readonly percentage: number;
  /** False when the action has expected entities but no report yet. */
  readonly reported: boolean;
};

export type SurfaceLevelImplementationEntry = {
  readonly status: SurfaceImplementationStatus | null;
  readonly expected: readonly ExpectedEntity[];
  readonly found: readonly FoundEntity[];
  readonly missing: readonly MissingEntity[];
  readonly expectedCount: number;
  readonly foundCount: number;
  readonly missingCount: number;
  readonly extraCount: number;
  readonly percentage: number;
  readonly reported: boolean;
};

export type SurfaceImplementationEntry = {
  readonly surface: Surface;
  /** Surface-scoped (states, data, surface rules/invariants). */
  readonly surfaceLevel: SurfaceLevelImplementationEntry;
  readonly perAction: readonly CapabilityImplementationEntry[];
  readonly expectedCount: number;
  readonly foundCount: number;
  readonly missingCount: number;
  readonly extraCount: number;
  readonly percentage: number;
  readonly reportedCount: number;
  readonly capabilitiesWithExpected: number;
};

export type ImplementationBreakdown = {
  readonly hasReport: boolean;
  readonly revision: number;
  readonly updatedAt: string | null;
  readonly perSurface: readonly SurfaceImplementationEntry[];
  readonly expectedCount: number;
  readonly foundCount: number;
  readonly missingCount: number;
  readonly extraCount: number;
  readonly percentage: number;
  readonly reportedCount: number;
  readonly capabilitiesWithExpected: number;
};

const pct = (found: number, expected: number): number =>
  expected === 0 ? 100 : Math.round((found / expected) * 100);

/**
 * Mirror of `auditImplementationTool`'s tag policy. We compute the spec-side
 * expected entities here too so the UI doesn't depend on a sidecar report
 * being present. A fresh, never-audited action still shows the right
 * entity rows, just with no `found` data attached.
 */
const buildExpectedForCapability = (action: Action): ExpectedEntity[] => {
  const slug = toSlug(action.name) || String(action.id);
  const out: ExpectedEntity[] = [
    {
      entityType: 'action',
      entityId: String(action.id),
      entityName: action.name,
      tag: `@unspa:action:${slug}`
    }
  ];
  for (const e of action.emittedEvents) {
    const name = String(e);
    out.push({
      entityType: 'event',
      entityId: name,
      entityName: name,
      tag: `@unspa:${slug}#${name}`
    });
  }
  for (const r of action.rules) {
    out.push({
      entityType: 'rule',
      entityId: String(r.id),
      entityName: r.description,
      tag: `@unspa:rule:${String(r.id)}`
    });
  }
  for (const inv of action.invariants) {
    const invSlug = toSlug(inv.name) || String(inv.id);
    out.push({
      entityType: 'invariant',
      entityId: String(inv.id),
      entityName: inv.name,
      tag: `@unspa:invariant:${invSlug}`
    });
  }
  for (const t of action.transitions) {
    out.push({
      entityType: 'transition',
      entityId: String(t.id),
      entityName: t.label,
      tag: `@unspa:transition:${String(t.id)}`
    });
  }
  return out;
};

const buildExpectedForSurface = (surface: Surface): ExpectedEntity[] => {
  const out: ExpectedEntity[] = [];
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
    out.push({
      entityType: 'surface_rule',
      entityId: String(r.id),
      entityName: r.description,
      tag: `@unspa:surface_rule:${String(r.id)}`
    });
  }
  for (const inv of surface.invariants) {
    const slug = toSlug(inv.name) || String(inv.id);
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

const buildCapabilityEntry = (
  action: Action,
  status: ActionImplementationStatus | null
): CapabilityImplementationEntry => {
  const expected = buildExpectedForCapability(action);
  const expectedKeys = new Set(expected.map((e) => keyOf(e.entityType, e.entityId)));

  if (!status) {
    return {
      action,
      status: null,
      expected,
      found: [],
      missing: expected.map((e) => ({
        entityType: e.entityType,
        entityId: e.entityId,
        entityName: e.entityName,
        tag: e.tag
      })),
      expectedCount: expected.length,
      foundCount: 0,
      missingCount: expected.length,
      extraCount: 0,
      percentage: expected.length === 0 ? 100 : 0,
      reported: false
    };
  }

  const foundForExpected = status.foundEntities.filter((f) =>
    expectedKeys.has(keyOf(f.entityType, f.entityId))
  );
  const foundKeys = new Set(foundForExpected.map((f) => keyOf(f.entityType, f.entityId)));
  const missing: MissingEntity[] = expected
    .filter((e) => !foundKeys.has(keyOf(e.entityType, e.entityId)))
    .map((e) => ({
      entityType: e.entityType,
      entityId: e.entityId,
      entityName: e.entityName,
      tag: e.tag
    }));

  return {
    action,
    status,
    expected,
    found: foundForExpected,
    missing,
    expectedCount: expected.length,
    foundCount: foundForExpected.length,
    missingCount: missing.length,
    extraCount: status.extraTags.length,
    percentage: pct(foundForExpected.length, expected.length),
    reported: true
  };
};

const buildSurfaceLevelEntry = (
  surface: Surface,
  status: SurfaceImplementationStatus | null
): SurfaceLevelImplementationEntry => {
  const expected = buildExpectedForSurface(surface);
  const expectedKeys = new Set(expected.map((e) => keyOf(e.entityType, e.entityId)));

  if (!status) {
    return {
      status: null,
      expected,
      found: [],
      missing: expected.map((e) => ({
        entityType: e.entityType,
        entityId: e.entityId,
        entityName: e.entityName,
        tag: e.tag
      })),
      expectedCount: expected.length,
      foundCount: 0,
      missingCount: expected.length,
      extraCount: 0,
      percentage: expected.length === 0 ? 100 : 0,
      reported: false
    };
  }

  const foundForExpected = status.foundEntities.filter((f) =>
    expectedKeys.has(keyOf(f.entityType, f.entityId))
  );
  const foundKeys = new Set(foundForExpected.map((f) => keyOf(f.entityType, f.entityId)));
  const missing: MissingEntity[] = expected
    .filter((e) => !foundKeys.has(keyOf(e.entityType, e.entityId)))
    .map((e) => ({
      entityType: e.entityType,
      entityId: e.entityId,
      entityName: e.entityName,
      tag: e.tag
    }));

  return {
    status,
    expected,
    found: foundForExpected,
    missing,
    expectedCount: expected.length,
    foundCount: foundForExpected.length,
    missingCount: missing.length,
    extraCount: status.extraTags.length,
    percentage: pct(foundForExpected.length, expected.length),
    reported: true
  };
};

export const computeImplementationBreakdown = (
  feature: Feature,
  status: ImplementationStatus | null
): ImplementationBreakdown => {
  const byAction = new Map<string, ActionImplementationStatus>();
  const bySurface = new Map<string, SurfaceImplementationStatus>();
  if (status) {
    for (const cap of status.actions) byAction.set(String(cap.actionId), cap);
    for (const s of status.surfaces) bySurface.set(String(s.surfaceId), s);
  }

  let totalExpected = 0;
  let totalFound = 0;
  let totalMissing = 0;
  let totalExtra = 0;
  let totalReported = 0;
  let totalWithExpected = 0;

  const perSurface: SurfaceImplementationEntry[] = feature.surfaces.map((surface) => {
    const entries = surface.actions.map((action) =>
      buildCapabilityEntry(action, byAction.get(String(action.id)) ?? null)
    );
    const surfaceLevel = buildSurfaceLevelEntry(
      surface,
      bySurface.get(String(surface.id)) ?? null
    );

    let surfaceExpected = surfaceLevel.expectedCount;
    let surfaceFound = surfaceLevel.foundCount;
    let surfaceMissing = surfaceLevel.missingCount;
    let surfaceExtra = surfaceLevel.extraCount;
    let surfaceReported = 0;
    let surfaceWithExpected = 0;
    for (const entry of entries) {
      surfaceExpected += entry.expectedCount;
      surfaceFound += entry.foundCount;
      surfaceMissing += entry.missingCount;
      surfaceExtra += entry.extraCount;
      if (entry.expectedCount > 0) surfaceWithExpected += 1;
      if (entry.reported) surfaceReported += 1;
    }
    totalExpected += surfaceExpected;
    totalFound += surfaceFound;
    totalMissing += surfaceMissing;
    totalExtra += surfaceExtra;
    totalReported += surfaceReported;
    totalWithExpected += surfaceWithExpected;
    return {
      surface,
      surfaceLevel,
      perAction: entries,
      expectedCount: surfaceExpected,
      foundCount: surfaceFound,
      missingCount: surfaceMissing,
      extraCount: surfaceExtra,
      percentage: pct(surfaceFound, surfaceExpected),
      reportedCount: surfaceReported,
      capabilitiesWithExpected: surfaceWithExpected
    };
  });

  return {
    hasReport: status !== null,
    revision: status?.revision ?? 0,
    updatedAt: status?.updatedAt ?? null,
    perSurface,
    expectedCount: totalExpected,
    foundCount: totalFound,
    missingCount: totalMissing,
    extraCount: totalExtra,
    percentage: pct(totalFound, totalExpected),
    reportedCount: totalReported,
    capabilitiesWithExpected: totalWithExpected
  };
};
