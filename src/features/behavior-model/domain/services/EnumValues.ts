import type { ValueSet } from '../entities/ValueSet';
import type { ValueSetId } from '../value-objects/ids';

type EnumCarrier = {
  readonly enumValues?: readonly string[];
  readonly valueSetId?: ValueSetId;
};

/**
 * The effective allowed values for an enum-typed field. A field either carries
 * inline `enumValues` or references a named ValueSet via `valueSetId`. Returns
 * `undefined` when neither is present, or when a `valueSetId` doesn't resolve
 * (the FeatureValidator reports the dangling reference separately, so callers
 * can treat "unresolved" the same as "no constraint" without crashing).
 *
 * Inline `enumValues` resolve without needing the value-set list, so existing
 * callers that don't pass `valueSets` keep working unchanged.
 */
export const effectiveEnumValues = (
  field: EnumCarrier,
  valueSets: readonly ValueSet[] | undefined
): readonly string[] | undefined => {
  if (field.valueSetId !== undefined) {
    return valueSets?.find((vs) => vs.id === field.valueSetId)?.values;
  }
  return field.enumValues;
};
