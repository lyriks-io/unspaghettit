/**
 * Zod-like, declarative validation rules attached directly to a Parameter.
 * They run during parameter validation, before any rules evaluate, and
 * surface as `parameterErrors` in the simulation result.
 */
export type ParameterValidation =
  // ── string presence ─────────────────────────────────────────────────────
  | { readonly type: 'non_empty'; readonly message?: string }

  // ── string formats ──────────────────────────────────────────────────────
  | { readonly type: 'email'; readonly message?: string }
  | { readonly type: 'url'; readonly message?: string }
  | { readonly type: 'uuid'; readonly message?: string }
  | { readonly type: 'ipv4'; readonly message?: string }
  | { readonly type: 'ipv6'; readonly message?: string }
  | { readonly type: 'hex'; readonly message?: string }
  | { readonly type: 'base64'; readonly message?: string }
  | { readonly type: 'slug'; readonly message?: string }
  | { readonly type: 'phone_e164'; readonly message?: string }
  | { readonly type: 'color_hex'; readonly message?: string }
  | { readonly type: 'semver'; readonly message?: string }
  | { readonly type: 'json'; readonly message?: string }
  | { readonly type: 'iso_date'; readonly message?: string }
  | { readonly type: 'iso_datetime'; readonly message?: string }
  | { readonly type: 'iso_time'; readonly message?: string }

  // ── string shape ────────────────────────────────────────────────────────
  | { readonly type: 'min_length'; readonly value: number; readonly message?: string }
  | { readonly type: 'max_length'; readonly value: number; readonly message?: string }
  | { readonly type: 'length'; readonly value: number; readonly message?: string }
  | { readonly type: 'pattern'; readonly value: string; readonly message?: string }
  | { readonly type: 'starts_with'; readonly value: string; readonly message?: string }
  | { readonly type: 'ends_with'; readonly value: string; readonly message?: string }
  | { readonly type: 'contains'; readonly value: string; readonly message?: string }
  | { readonly type: 'alphanumeric'; readonly message?: string }
  | { readonly type: 'alphabetic'; readonly message?: string }
  | { readonly type: 'lowercase'; readonly message?: string }
  | { readonly type: 'uppercase'; readonly message?: string }
  | { readonly type: 'no_whitespace'; readonly message?: string }

  // ── number bounds ───────────────────────────────────────────────────────
  | { readonly type: 'min'; readonly value: number; readonly message?: string }
  | { readonly type: 'max'; readonly value: number; readonly message?: string }
  | { readonly type: 'integer'; readonly message?: string }
  | { readonly type: 'positive'; readonly message?: string }
  | { readonly type: 'negative'; readonly message?: string }
  | { readonly type: 'non_negative'; readonly message?: string }
  | { readonly type: 'non_positive'; readonly message?: string }
  | { readonly type: 'multiple_of'; readonly value: number; readonly message?: string }
  | { readonly type: 'finite'; readonly message?: string }
  | { readonly type: 'safe_integer'; readonly message?: string };

export type ParameterValidationType = ParameterValidation['type'];

/**
 * Logical grouping for the editor UI's dropdown so the long list stays
 * navigable. Order within each group reflects how often the validator is
 * actually useful (most common first).
 */
export type ValidationCategory = 'presence' | 'format' | 'shape' | 'range';

export const VALIDATION_GROUPS: ReadonlyArray<{
  readonly category: ValidationCategory;
  readonly label: string;
  readonly types: readonly ParameterValidationType[];
}> = [
  {
    category: 'presence',
    label: 'Presence',
    types: ['non_empty']
  },
  {
    category: 'format',
    label: 'Format',
    types: [
      'email',
      'url',
      'uuid',
      'ipv4',
      'ipv6',
      'hex',
      'base64',
      'slug',
      'phone_e164',
      'color_hex',
      'semver',
      'json',
      'iso_date',
      'iso_datetime',
      'iso_time'
    ]
  },
  {
    category: 'shape',
    label: 'Shape',
    types: [
      'min_length',
      'max_length',
      'length',
      'pattern',
      'starts_with',
      'ends_with',
      'contains',
      'alphanumeric',
      'alphabetic',
      'lowercase',
      'uppercase',
      'no_whitespace'
    ]
  },
  {
    category: 'range',
    label: 'Range',
    types: [
      'min',
      'max',
      'multiple_of',
      'integer',
      'finite',
      'safe_integer',
      'positive',
      'negative',
      'non_negative',
      'non_positive'
    ]
  }
];

export const ALL_VALIDATION_TYPES: readonly ParameterValidationType[] = VALIDATION_GROUPS.flatMap(
  (g) => g.types
);

export const validationTypeLabel = (t: ParameterValidationType): string => {
  switch (t) {
    case 'non_empty':
      return 'Non-empty';
    case 'min_length':
      return 'Min length';
    case 'max_length':
      return 'Max length';
    case 'length':
      return 'Exact length';
    case 'pattern':
      return 'Match regex';
    case 'starts_with':
      return 'Starts with';
    case 'ends_with':
      return 'Ends with';
    case 'contains':
      return 'Contains substring';
    case 'alphanumeric':
      return 'Alphanumeric only';
    case 'alphabetic':
      return 'Letters only';
    case 'lowercase':
      return 'Lowercase only';
    case 'uppercase':
      return 'Uppercase only';
    case 'no_whitespace':
      return 'No whitespace';
    case 'email':
      return 'Email address';
    case 'url':
      return 'URL';
    case 'uuid':
      return 'UUID';
    case 'ipv4':
      return 'IPv4 address';
    case 'ipv6':
      return 'IPv6 address';
    case 'hex':
      return 'Hex string';
    case 'base64':
      return 'Base64';
    case 'slug':
      return 'Slug (URL-safe)';
    case 'phone_e164':
      return 'Phone (E.164)';
    case 'color_hex':
      return 'Hex color';
    case 'semver':
      return 'SemVer';
    case 'json':
      return 'Valid JSON';
    case 'iso_date':
      return 'ISO date (YYYY-MM-DD)';
    case 'iso_datetime':
      return 'ISO datetime';
    case 'iso_time':
      return 'ISO time';
    case 'min':
      return 'Min value';
    case 'max':
      return 'Max value';
    case 'multiple_of':
      return 'Multiple of';
    case 'integer':
      return 'Integer';
    case 'finite':
      return 'Finite';
    case 'safe_integer':
      return 'Safe integer';
    case 'positive':
      return 'Positive';
    case 'negative':
      return 'Negative';
    case 'non_negative':
      return 'Non-negative';
    case 'non_positive':
      return 'Non-positive';
  }
};

export const validationRequiresValue = (
  t: ParameterValidationType
): 'number' | 'string' | null => {
  switch (t) {
    case 'min_length':
    case 'max_length':
    case 'length':
    case 'min':
    case 'max':
    case 'multiple_of':
      return 'number';
    case 'pattern':
    case 'starts_with':
    case 'ends_with':
    case 'contains':
      return 'string';
    default:
      return null;
  }
};

export const validationAppliesTo = (
  t: ParameterValidationType
): 'string' | 'number' | 'any' => {
  switch (t) {
    case 'non_empty':
    case 'min_length':
    case 'max_length':
    case 'length':
    case 'pattern':
    case 'starts_with':
    case 'ends_with':
    case 'contains':
    case 'alphanumeric':
    case 'alphabetic':
    case 'lowercase':
    case 'uppercase':
    case 'no_whitespace':
    case 'email':
    case 'url':
    case 'uuid':
    case 'ipv4':
    case 'ipv6':
    case 'hex':
    case 'base64':
    case 'slug':
    case 'phone_e164':
    case 'color_hex':
    case 'semver':
    case 'json':
    case 'iso_date':
    case 'iso_datetime':
    case 'iso_time':
      return 'string';
    case 'min':
    case 'max':
    case 'multiple_of':
    case 'integer':
    case 'finite':
    case 'safe_integer':
    case 'positive':
    case 'negative':
    case 'non_negative':
    case 'non_positive':
      return 'number';
  }
};
