import { ALL_RULE_CATEGORIES } from '../../value-objects/RuleCategory';
import { LEGACY_CATEGORY_MAP } from '../FeatureRuleCategoryNormalizer';
import {
  typeOfStateValue,
  type StateType,
  type StateValue
} from '../../value-objects/StateValue';

export const VALID_RULE_CATEGORIES = new Set<string>(ALL_RULE_CATEGORIES);

export const categoryHint = (category: string): string => {
  // Known legacy / pre-canonical names get a precise "did you mean" pointing
  // at the canonical replacement.
  if (category in LEGACY_CATEGORY_MAP) {
    return `Did you mean "${LEGACY_CATEGORY_MAP[category]!}"?`;
  }
  return `Valid categories: ${[...VALID_RULE_CATEGORIES].join(', ')}.`;
};

export type ValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly errors: readonly string[] };

const valueLabel = (value: StateValue): string => {
  if (typeof value === 'string') return `"${value}"`;
  return JSON.stringify(value);
};

export const defaultValueHint = (value: StateValue, type: StateType): string => {
  const actual = typeOfStateValue(value);
  const base = `Received ${valueLabel(value)} (${actual}); expected ${type}.`;
  if (typeof value !== 'string') return base;

  if (type === 'boolean' && (value === 'true' || value === 'false')) {
    return `${base} Use ${value} instead of "${value}".`;
  }
  if (type === 'number' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return `${base} Use ${Number(value)} instead of "${value}".`;
  }
  if (type === 'array' && value.trim().startsWith('[')) {
    return `${base} Use a JSON array value, not a JSON-encoded string.`;
  }
  if (type === 'object' && value.trim().startsWith('{')) {
    return `${base} Use a JSON object value, not a JSON-encoded string.`;
  }
  return base;
};

const hasDescription = (value: { readonly description?: string } | undefined): boolean =>
  typeof value?.description === 'string' && value.description.trim().length > 0;

export const requireDescription = (
  errors: string[],
  label: string,
  value: { readonly description?: string } | undefined
): void => {
  if (!hasDescription(value)) errors.push(`${label} is missing a description.`);
};
