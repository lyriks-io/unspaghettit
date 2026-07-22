export type Tag = {
  readonly type: string;
  readonly value: string;
};

/**
 * Trim only. Tag TEXT is stored byte-for-byte as authored: consumers outside
 * the engine (the Lyriks platform keys its Features projection off `core:` /
 * family / phase tag values) match tag values exactly, so lowercasing on the
 * way to disk silently emptied their projection on any write that touched a
 * tagged feature. IDENTITY stays case-insensitive (see `tagKey`), so
 * "Data Model" and "data model" are still the same tag for dedupe, lookup,
 * filtering, and rename — only the stored spelling is preserved.
 */
const normalizeField = (text: string): string => text.trim();

/**
 * Case-insensitive identity for a tag. Every dedupe, lookup, filter, and rename
 * goes through this, which is what lets `normalizeTags` keep the authored
 * spelling without splitting "Growth" and "growth" into two tags.
 */
export const tagKey = (tag: Tag): string =>
  `${tag.type.trim().toLowerCase()}:${tag.value.trim().toLowerCase()}`;

export const normalizeTags = (
  tags: readonly Tag[] | undefined,
  legacy?: { readonly type?: string; readonly value?: string }
): readonly Tag[] | undefined => {
  const byKey = new Map<string, Tag>();
  for (const tag of tags ?? []) {
    const type = normalizeField(tag.type);
    const value = normalizeField(tag.value);
    if (!type || !value) continue;
    // Keyed case-insensitively (dedupe is identity), but the FIRST spelling
    // seen wins so a later duplicate in different case can't rewrite the
    // authored casing out from under a consumer.
    const key = tagKey({ type, value });
    if (!byKey.has(key)) byKey.set(key, { type, value });
  }
  const legacyValue = normalizeField(legacy?.value ?? '');
  if (legacyValue) {
    const type = normalizeField(legacy?.type ?? '') || 'tag';
    const key = tagKey({ type, value: legacyValue });
    if (!byKey.has(key)) byKey.set(key, { type, value: legacyValue });
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
 * Title-case a tag fragment for display. Splits on whitespace, hyphens, and
 * underscores so "user_role" and "user-role" both render as "User Role".
 *
 * A segment that ALREADY carries an uppercase letter is passed through
 * untouched: since `normalizeTags` preserves authored casing, down-casing here
 * would render "MCP" as "Mcp" and "dataModel" as "Datamodel". Only all-lowercase
 * segments (every legacy tag, and anything typed casually) get title-cased.
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
      if (/[A-Z]/.test(segment)) return segment;
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join('');
};

export const tagLabel = (tag: Tag): string =>
  `${humanizeTagText(tag.type)}: ${humanizeTagText(tag.value)}`;

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
