import type { Disabled } from '$features/behavior-model/domain/entities/Disabled';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import { disabledIndexKeys } from '$features/behavior-model/domain/services/DisabledElements';
import type {
  ActionImplementationStatus,
  ImplementationStatus,
  MissingEntity,
  SurfaceImplementationStatus
} from './ImplementationStatus';

/**
 * The implementation status as a reader takes it once elements are disabled:
 * a disabled element keeps its index entries and its located code, and reads
 * disabled, never missing. Pure, read-time only: the stored reports are left
 * as the last sync wrote them, so enabling the element reads them back as they
 * were.
 */

/** A row of a disabled action (or of any action of a disabled feature) carries its marker. */
export type DisabledMark = { readonly disabled?: Disabled };

/** Entities the spec still declares but no reading counts, each with the marker that puts it aside. */
export type DisabledEntities = { readonly disabledEntities?: readonly MissingEntity[] };

const keysOf = (e: MissingEntity): readonly string[] => [
  `${e.entityType}:${e.entityId}`,
  ...(e.entityName ? [`${e.entityType}:${e.entityName}`] : [])
];

const splitMissing = <T extends { readonly missingEntities: readonly MissingEntity[] }>(
  row: T,
  off: ReadonlySet<string>,
  all: boolean
): T & DisabledEntities => {
  const set = all ? row.missingEntities : row.missingEntities.filter((e) => keysOf(e).some((k) => off.has(k)));
  if (set.length === 0) return row;
  return {
    ...row,
    missingEntities: all ? [] : row.missingEntities.filter((e) => !set.includes(e)),
    disabledEntities: set
  };
};

const actionMarker = (feature: Feature, actionId: string): Disabled | undefined => {
  if (feature.disabled) return feature.disabled;
  for (const surface of feature.surfaces) {
    const action = surface.actions.find((a) => String(a.id) === actionId);
    if (action) return action.disabled;
  }
  return undefined;
};

/** One action row read against the feature as it is now. */
export const readActionDisabled = (
  feature: Feature,
  row: ActionImplementationStatus,
  off: ReadonlySet<string> = disabledIndexKeys(feature)
): ActionImplementationStatus & DisabledMark & DisabledEntities => {
  const marker = actionMarker(feature, String(row.actionId));
  const split = splitMissing(row, off, marker !== undefined);
  return marker ? { ...split, disabled: marker } : split;
};

/** One surface row read against the feature as it is now. */
export const readSurfaceDisabled = (
  feature: Feature,
  row: SurfaceImplementationStatus,
  off: ReadonlySet<string> = disabledIndexKeys(feature)
): SurfaceImplementationStatus & DisabledMark & DisabledEntities => {
  const split = splitMissing(row, off, feature.disabled !== undefined);
  return feature.disabled ? { ...split, disabled: feature.disabled } : split;
};

/** The whole status read against the feature as it is now; unchanged when nothing is disabled. */
export const readStatusDisabled = (
  feature: Feature,
  status: ImplementationStatus
): ImplementationStatus => {
  const off = disabledIndexKeys(feature);
  if (off.size === 0) return status;
  return {
    ...status,
    actions: status.actions.map((row) => readActionDisabled(feature, row, off)),
    surfaces: status.surfaces.map((row) => readSurfaceDisabled(feature, row, off))
  };
};
