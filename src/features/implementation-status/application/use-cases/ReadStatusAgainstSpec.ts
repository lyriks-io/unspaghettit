import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import { toSlug } from '$features/behavior-model/domain/value-objects/slug';
import type {
  ActionImplementationStatus,
  ExpectedEntity,
  FoundEntity,
  ImplementationStatus,
  SurfaceImplementationStatus
} from '$features/implementation-status/domain/ImplementationStatus';
import {
  buildExpectedCapabilityEntities,
  buildExpectedSurfaceEntities
} from './ReportImplementationStatus';

/**
 * The reports a status record keeps for actions and surfaces the spec no longer
 * has, by id: counted apart, never read as coverage.
 */
export type OrphanedReports = {
  readonly actions: readonly string[];
  readonly surfaces: readonly string[];
};

export type StatusAgainstSpec = ImplementationStatus & { readonly orphanedReports?: OrphanedReports };

/**
 * A stored report as it reads against what its action or surface declares NOW:
 * what was located and is still declared stays found (its locations as the sync
 * left them), what is declared and was never located reads missing, and what
 * was located but the spec no longer declares drops out.
 */
const reconcileRow = <T extends ActionImplementationStatus | SurfaceImplementationStatus>(
  row: T,
  expected: readonly ExpectedEntity[]
): T => {
  const keyOf = (e: { readonly entityType: string; readonly entityId: string }) => `${e.entityType}:${e.entityId}`;
  const located = new Map(row.foundEntities.map((f) => [keyOf(f), f] as const));
  const foundEntities: FoundEntity[] = [];
  const missingEntities: ExpectedEntity[] = [];
  for (const e of expected) {
    const found = located.get(keyOf(e));
    if (found) foundEntities.push({ ...found, entityName: e.entityName, tag: e.tag });
    else missingEntities.push(e);
  }
  return { ...row, expectedEntities: expected, foundEntities, missingEntities };
};

/**
 * The implementation status read against the spec as it is now. A report is
 * written once per sync and kept: an action removed since, or a rule added
 * since, left it describing a spec that no longer exists, and every reader that
 * tallies coverage from it (the coverage of a feature in Lyriks, the proven
 * actions) counted the removed action as implemented and the new rule as
 * nowhere to build. Read-time only, like the disabled reading: the stored
 * record is left as the sync wrote it.
 */
export const readStatusAgainstSpec = (
  feature: Feature,
  status: ImplementationStatus
): StatusAgainstSpec => {
  const orphanActions: string[] = [];
  const orphanSurfaces: string[] = [];
  const actions: ActionImplementationStatus[] = [];
  for (const row of status.actions) {
    const surface = feature.surfaces.find((s) => s.actions.some((a) => String(a.id) === String(row.actionId)));
    const action = surface?.actions.find((a) => String(a.id) === String(row.actionId));
    if (!surface || !action) {
      orphanActions.push(String(row.actionId));
      continue;
    }
    const slug = toSlug(action.name) || String(action.id);
    actions.push(
      reconcileRow(
        { ...row, actionSlug: slug, actionName: action.name, surfaceId: surface.id },
        buildExpectedCapabilityEntities(action, slug)
      )
    );
  }
  const surfaces: SurfaceImplementationStatus[] = [];
  for (const row of status.surfaces) {
    const surface = feature.surfaces.find((s) => String(s.id) === String(row.surfaceId));
    if (!surface) {
      orphanSurfaces.push(String(row.surfaceId));
      continue;
    }
    surfaces.push(
      reconcileRow(
        { ...row, surfaceSlug: toSlug(surface.name) || String(surface.id), surfaceName: surface.name },
        buildExpectedSurfaceEntities(surface)
      )
    );
  }
  return {
    ...status,
    actions,
    surfaces,
    ...(orphanActions.length > 0 || orphanSurfaces.length > 0
      ? { orphanedReports: { actions: orphanActions, surfaces: orphanSurfaces } }
      : {})
  };
};
