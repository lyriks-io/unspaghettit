export type Tag = {
  readonly type: string;
  readonly value: string;
};

const normalizeField = (text: string): string => text.trim().toLowerCase();

export const normalizeTags = (
  tags: readonly Tag[] | undefined,
  legacy?: { readonly type?: string; readonly value?: string }
): readonly Tag[] | undefined => {
  const byKey = new Map<string, Tag>();
  for (const tag of tags ?? []) {
    const type = normalizeField(tag.type);
    const value = normalizeField(tag.value);
    if (!type || !value) continue;
    byKey.set(`${type}:${value}`, { type, value });
  }
  const legacyValue = normalizeField(legacy?.value ?? '');
  if (legacyValue) {
    const type = normalizeField(legacy?.type ?? '') || 'tag';
    byKey.set(`${type}:${legacyValue}`, { type, value: legacyValue });
  }
  const normalized = [...byKey.values()];
  return normalized.length > 0 ? normalized : undefined;
};

export const addTag = (
  tags: readonly Tag[] | undefined,
  tag: Tag
): readonly Tag[] | undefined => {
  // Idempotent: if the same key is already present, preserve the original
  // casing rather than letting normalizeTags' last-write-wins overwrite it.
  if (tags && tags.some((existing) => tagKey(existing) === tagKey(tag))) {
    return tags;
  }
  return normalizeTags([...(tags ?? []), tag]);
};

export const removeTag = (
  tags: readonly Tag[] | undefined,
  tag: Tag
): readonly Tag[] | undefined => {
  if (!tags || tags.length === 0) return undefined;
  const key = tagKey(tag);
  const next = tags.filter((existing) => tagKey(existing) !== key);
  return next.length > 0 ? next : undefined;
};

/**
 * Title-case a tag fragment for display. Tags are stored lowercase (see
 * `normalizeTags`) so the human-friendly casing is recomputed from the raw
 * value at render time. Splits on whitespace, hyphens, and underscores so
 * "user_role" and "user-role" both render as "User Role".
 */
export const humanizeTagText = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return trimmed
    .split(/(\s+|[-_])/)
    .map((segment) => {
      if (segment.length === 0) return segment;
      if (/^\s+$/.test(segment)) return ' ';
      if (segment === '-' || segment === '_') return ' ';
      return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase();
    })
    .join('');
};

export const tagLabel = (tag: Tag): string =>
  `${humanizeTagText(tag.type)}: ${humanizeTagText(tag.value)}`;

export const tagKey = (tag: Tag): string =>
  `${tag.type.trim().toLowerCase()}:${tag.value.trim().toLowerCase()}`;

/**
 * Returns a new tag list with any tag matching `from` rewritten to `to`.
 * Falls back to undefined when the resulting list is empty so callers can
 * persist the same "absent" shape the rest of the codebase uses.
 */
export const renameTagInList = (
  tags: readonly Tag[] | undefined,
  from: Tag,
  to: Tag
): readonly Tag[] | undefined => {
  if (!tags || tags.length === 0) return tags;
  const fromKey = tagKey(from);
  let touched = false;
  const rewritten = tags.map((existing) => {
    if (tagKey(existing) !== fromKey) return existing;
    touched = true;
    return to;
  });
  if (!touched) return tags;
  return normalizeTags(rewritten);
};
