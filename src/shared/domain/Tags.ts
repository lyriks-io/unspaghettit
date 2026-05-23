export type Tag = {
  readonly type: string;
  readonly value: string;
};

export const normalizeTags = (
  tags: readonly Tag[] | undefined,
  legacy?: { readonly type?: string; readonly value?: string }
): readonly Tag[] | undefined => {
  const byKey = new Map<string, Tag>();
  for (const tag of tags ?? []) {
    const type = tag.type.trim();
    const value = tag.value.trim();
    if (!type || !value) continue;
    byKey.set(`${type.toLowerCase()}:${value.toLowerCase()}`, { type, value });
  }
  const legacyValue = legacy?.value?.trim();
  if (legacyValue) {
    const type = legacy?.type?.trim() || 'Tag';
    byKey.set(`${type.toLowerCase()}:${legacyValue.toLowerCase()}`, {
      type,
      value: legacyValue
    });
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

export const tagLabel = (tag: Tag): string => `${tag.type}: ${tag.value}`;

export const tagKey = (tag: Tag): string =>
  `${tag.type.trim().toLowerCase()}:${tag.value.trim().toLowerCase()}`;
