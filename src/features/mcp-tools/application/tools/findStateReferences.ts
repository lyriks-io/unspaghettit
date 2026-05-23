import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import {
  countStatePathReferences,
  totalReferences,
  type StatePathReferences
} from '$features/behavior-model/domain/services/StatePathReferences';
import type { StatePath } from '$features/behavior-model/domain/value-objects/StatePath';

export type FindStateReferencesOutput = StatePathReferences & {
  readonly total: number;
};

export const findStateReferencesTool = (
  feature: Feature,
  path: StatePath
): FindStateReferencesOutput => {
  const refs = countStatePathReferences(feature, path);
  return { ...refs, total: totalReferences(refs) };
};
