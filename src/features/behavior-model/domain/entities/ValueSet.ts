import type { ValueSetId } from '../value-objects/ids';

/**
 * A named, reusable set of allowed string values — an enum the model can
 * reference by id. Declared once at the feature level; a StateDefinition or
 * Parameter of type `enum` points at it via `valueSetId` instead of inlining
 * its own `enumValues`. Editing the allowed values then happens in ONE place
 * and every referencing field stays in sync, removing the "edit the enum in
 * two places" drift between a state path and the parameters that feed it.
 */
export type ValueSet = {
  readonly id: ValueSetId;
  readonly name: string;
  readonly values: readonly string[];
  readonly description?: string;
};
