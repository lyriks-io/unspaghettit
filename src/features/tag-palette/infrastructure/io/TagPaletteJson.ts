import {
  emptyTagPalette,
  isTagColor,
  normalizeTagColor,
  type TagAssignment,
  type TagPalette
} from '$shared/domain/TagPalette';

type TagPaletteFile = {
  readonly version: 1;
  readonly assignments: Readonly<Record<string, TagAssignment>>;
};

export const exportTagPaletteToJson = (palette: TagPalette): string => {
  const file: TagPaletteFile = { version: 1, assignments: palette.assignments };
  return JSON.stringify(file, null, 2);
};

export const importTagPaletteFromJson = (raw: string): TagPalette => {
  if (raw.trim().length === 0) return emptyTagPalette;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyTagPalette;
  }
  if (!parsed || typeof parsed !== 'object') return emptyTagPalette;
  const assignments = (parsed as { assignments?: unknown }).assignments;
  if (!assignments || typeof assignments !== 'object') return emptyTagPalette;
  const valid: Record<string, TagAssignment> = {};
  for (const [type, value] of Object.entries(assignments as Record<string, unknown>)) {
    const key = type.trim().toLowerCase();
    if (!key) continue;
    if (value === null) {
      valid[key] = null;
      continue;
    }
    if (!isTagColor(value)) continue;
    valid[key] = normalizeTagColor(value);
  }
  return { assignments: valid };
};
