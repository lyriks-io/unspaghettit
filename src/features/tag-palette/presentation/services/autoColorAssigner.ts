import type { TagColor, TagPalette } from '$shared/domain/TagPalette';
import { TAG_PRESETS } from '$features/tag-palette/presentation/services/tagPresets';

/**
 * Resolve auto colors for every tag type that hasn't been explicitly set
 * (neither colored nor cleared). The goal is global uniqueness: as long as
 * the count of unassigned types fits within the preset palette, each type
 * gets a distinct preset that's also distinct from any color a user
 * explicitly assigned to another type. When unassigned types outnumber the
 * remaining presets we cycle through them; collisions among auto-assigned
 * types are unavoidable past that point but never collide with explicit ones.
 *
 * Pure function so the assignment is stable for the same inputs and can be
 * memoized by the caller via $derived.
 */
export const assignAutoColors = (
  knownTypes: readonly string[],
  palette: TagPalette
): ReadonlyMap<string, TagColor> => {
  const result = new Map<string, TagColor>();
  if (TAG_PRESETS.length === 0) return result;

  // Normalize + dedupe + sort so the assignment is stable regardless of how
  // the caller collected types (insertion order, async loads, etc.).
  const normalized = [
    ...new Set(
      knownTypes
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0)
    )
  ].sort();

  // Reserve every preset already taken by an explicit assignment so auto
  // picks never duplicate a user-chosen color.
  const reserved = new Set<TagColor>();
  for (const value of Object.values(palette.assignments)) {
    if (typeof value === 'string') reserved.add(value);
  }
  const available = TAG_PRESETS.filter((preset) => !reserved.has(preset.color));
  // If the user manually claimed every preset, fall back to the full set so
  // we still hand out *something* deterministic. The result will collide
  // with explicit assignments — acceptable since the user opted in.
  const pool = available.length > 0 ? available : TAG_PRESETS;

  let cursor = 0;
  for (const type of normalized) {
    const assignment = palette.assignments[type];
    if (typeof assignment === 'string') continue; // explicit color
    if (assignment === null) continue; // explicitly cleared
    result.set(type, pool[cursor % pool.length]!.color);
    cursor++;
  }
  return result;
};
