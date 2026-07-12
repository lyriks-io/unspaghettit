import type { Tag } from './Tags';
import { normalizeTags } from './Tags';

/**
 * The reserved tag namespace that designates a feature's CORE-FEATURE
 * membership. A feature "belongs to" a core feature by carrying a
 * `{ type: 'core', value: '<coreFeatureValue>' }` tag. Reserving a dedicated
 * type is what keeps core features filterable and precise: a descriptive tag
 * like `security` lives under a different type and can never be mistaken for a
 * core-feature designation. The value only *counts* as a real core feature when
 * it resolves to an entry in the owning project's core-feature registry
 * (see CoreFeature / coreFeatures service); an unresolved value is a soft
 * warning, never a hard error.
 */
export const CORE_TAG_TYPE = 'core';

const isCoreTag = (tag: Tag): boolean => tag.type.trim().toLowerCase() === CORE_TAG_TYPE;

/** Every `core:` value carried by a tag set, normalized lowercase, in order. */
export const coreValuesOf = (tags: readonly Tag[] | undefined): readonly string[] =>
  (tags ?? []).filter(isCoreTag).map((t) => t.value.trim().toLowerCase());

/**
 * The single core-feature value a tag set belongs to (at-most-one is the rule).
 * Returns the first if several are somehow present; the >1 case surfaces as a
 * soft warning in the project's core-feature report.
 */
export const coreValueOf = (tags: readonly Tag[] | undefined): string | undefined =>
  coreValuesOf(tags)[0];

/**
 * Set (or clear, with `null`/empty) a tag set's core-feature membership,
 * enforcing at-most-one: every existing `core:` tag is dropped first, so the
 * result carries exactly zero or one. Other tags are untouched.
 */
export const setCoreTag = (
  tags: readonly Tag[] | undefined,
  value: string | null | undefined
): readonly Tag[] | undefined => {
  const withoutCore = (tags ?? []).filter((t) => !isCoreTag(t));
  const trimmed = value?.trim();
  return normalizeTags(
    trimmed ? [...withoutCore, { type: CORE_TAG_TYPE, value: trimmed }] : withoutCore
  );
};
