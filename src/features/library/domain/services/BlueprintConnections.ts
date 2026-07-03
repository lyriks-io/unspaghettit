import type { SurfaceBlueprint } from '../entities/SurfaceBlueprint';
import type { BlueprintId } from '../value-objects/BlueprintId';

/**
 * Two blueprints can connect if either one lists the other as a sibling.
 * `siblings` is what each blueprint's `build` reads to emit cross-surface
 * transitions, so a declared sibling on *either* side means selecting both
 * wires up at least one link. The relationship is treated as symmetric for
 * highlighting even though the transition it produces has a direction.
 */
export const areBlueprintsConnectable = (
  a: SurfaceBlueprint,
  b: SurfaceBlueprint
): boolean =>
  a.id !== b.id &&
  ((a.siblings?.includes(b.id) ?? false) || (b.siblings?.includes(a.id) ?? false));

/**
 * For the current selection, find every *unselected* blueprint that would wire
 * up to at least one selected blueprint, mapped to the names of the selected
 * blueprints it connects to. Lets the library highlight "add this and it links
 * to your picks" so the connection preview isn't the first time a user sees the
 * relationship. Returns an empty map when nothing is selected.
 */
export const connectableToSelection = (
  blueprints: readonly SurfaceBlueprint[],
  selectedIds: ReadonlySet<BlueprintId>
): ReadonlyMap<BlueprintId, readonly string[]> => {
  const selected = blueprints.filter((b) => selectedIds.has(b.id));
  const out = new Map<BlueprintId, readonly string[]>();
  if (selected.length === 0) return out;
  for (const bp of blueprints) {
    if (selectedIds.has(bp.id)) continue;
    const links = selected
      .filter((s) => areBlueprintsConnectable(bp, s))
      .map((s) => s.name)
      .sort((a, b) => a.localeCompare(b));
    if (links.length > 0) out.set(bp.id, links);
  }
  return out;
};
