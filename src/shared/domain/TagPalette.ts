import type { Tag } from './Tags';

/**
 * A tag's color is stored as a 6-digit hex string (e.g. "#3b82f6"). The
 * palette also supports a "cleared" sentinel (null) so a user can explicitly
 * declare a type as colorless. A type with no entry at all is "unassigned"
 * and the presentation layer auto-picks a preset for it.
 *
 * Three states per type:
 *   - undefined  -> never assigned, gets an auto preset color at render time
 *   - null       -> explicitly cleared, renders with the "no color" icon
 *   - TagColor   -> explicit hex color
 */
export type TagColor = string;

export type TagAssignment = TagColor | null;

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

export const isTagColor = (value: unknown): value is TagColor =>
  typeof value === 'string' && HEX_COLOR_REGEX.test(value);

export const normalizeTagColor = (value: string): TagColor =>
  value.toLowerCase();

export type TagPalette = {
  readonly assignments: Readonly<Record<string, TagAssignment>>;
};

export const emptyTagPalette: TagPalette = { assignments: {} };

const normalizeType = (type: string): string => type.trim().toLowerCase();

export const setTypeColor = (
  palette: TagPalette,
  type: string,
  color: TagColor
): TagPalette => {
  const key = normalizeType(type);
  if (!key) return palette;
  const normalized = normalizeTagColor(color);
  if (palette.assignments[key] === normalized) return palette;
  return { assignments: { ...palette.assignments, [key]: normalized } };
};

/**
 * Marks a type as explicitly colorless. This is the user-driven "No color"
 * action; auto-assignment will NOT step in for cleared types.
 */
export const clearTypeColor = (palette: TagPalette, type: string): TagPalette => {
  const key = normalizeType(type);
  if (!key) return palette;
  if (palette.assignments[key] === null) return palette;
  return { assignments: { ...palette.assignments, [key]: null } };
};

/**
 * Drops a type's entry entirely so it falls back to auto-assignment again.
 * Used when a rename leaves no users behind so stale entries don't linger.
 */
export const unsetTypeColor = (palette: TagPalette, type: string): TagPalette => {
  const key = normalizeType(type);
  if (!(key in palette.assignments)) return palette;
  const next = { ...palette.assignments };
  delete next[key];
  return { assignments: next };
};

export const getAssignment = (
  palette: TagPalette,
  type: string
): TagAssignment | undefined => palette.assignments[normalizeType(type)];

export const isExplicitlyCleared = (palette: TagPalette, type: string): boolean =>
  getAssignment(palette, type) === null;

export const explicitColorOf = (
  palette: TagPalette,
  type: string
): TagColor | null => {
  const value = getAssignment(palette, type);
  return typeof value === 'string' ? value : null;
};

export const explicitColorOfTag = (palette: TagPalette, tag: Tag): TagColor | null =>
  explicitColorOf(palette, tag.type);

/**
 * After a rename of `oldType` -> `newType`, carry over whatever assignment
 * the user had — including the explicit "cleared" state — so the renamed
 * type keeps the user's intent. No-op when oldType and newType normalize
 * the same, or when no assignment existed.
 */
export const renameTypeColor = (
  palette: TagPalette,
  oldType: string,
  newType: string
): TagPalette => {
  const from = normalizeType(oldType);
  const to = normalizeType(newType);
  if (!from || !to || from === to) return palette;
  if (!(from in palette.assignments)) return palette;
  const assignment = palette.assignments[from] as TagAssignment;
  const next = { ...palette.assignments };
  delete next[from];
  next[to] = assignment;
  return { assignments: next };
};
