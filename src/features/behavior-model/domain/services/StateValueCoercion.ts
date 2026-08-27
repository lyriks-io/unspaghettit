import {
  isStateValueAssignableTo,
  type StateType,
  type StateValue
} from '../value-objects/StateValue';

const tryParseJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};

const fallbackForType = (type: StateType, enumValues?: readonly string[]): StateValue => {
  switch (type) {
    case 'string':
      return '';
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'enum':
      return enumValues?.[0] ?? '';
    case 'object':
      return {};
    case 'array':
      return [];
    default:
      return null;
  }
};

/**
 * Coerce a raw value into a `StateValue` of the requested `type`.
 *
 * Tolerates the legacy on-disk shape where defaults were JSON-stringified
 * before being written (e.g. `"365"` for `type: number`, `"\"helper\""` for
 * `type: enum`, `"false"` for `type: boolean`). Used by the migration tool
 * to repair existing snapshots in place. The runtime validator rejects
 * mistyped defaults outright once the migration has been applied.
 *
 * Returns `{ value, changed }`. `changed` is `false` only when the input was
 * already a valid in-type value, so callers can skip writes that wouldn't
 * touch disk.
 */
export const coerceDefaultValue = (
  raw: unknown,
  type: StateType,
  enumValues?: readonly string[]
): { readonly value: StateValue; readonly changed: boolean } => {
  const inEnum = (v: unknown): boolean =>
    type !== 'enum' || !enumValues || (typeof v === 'string' && enumValues.includes(v));

  const accept = (v: unknown): boolean =>
    isStateValueAssignableTo(v as StateValue, type) && inEnum(v);

  if (accept(raw)) {
    return { value: raw as StateValue, changed: false };
  }

  // Legacy shape: defaultValue was stored as JSON-encoded string.
  if (typeof raw === 'string') {
    const parsed = tryParseJson(raw);
    if (parsed !== undefined && accept(parsed)) {
      return { value: parsed as StateValue, changed: true };
    }

    // Best-effort primitive coercion.
    if (type === 'number') {
      const n = Number(raw);
      if (Number.isFinite(n)) return { value: n, changed: true };
    }
    if (type === 'boolean') {
      if (raw === 'true') return { value: true, changed: true };
      if (raw === 'false') return { value: false, changed: true };
    }
    if (type === 'string') {
      return { value: raw, changed: true };
    }
    if (type === 'enum' && (!enumValues || enumValues.includes(raw))) {
      return { value: raw, changed: true };
    }
  }

  return { value: fallbackForType(type, enumValues), changed: true };
};
