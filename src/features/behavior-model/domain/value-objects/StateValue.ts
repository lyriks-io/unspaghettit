export type StatePrimitive = string | number | boolean | null;

export type StateValue =
  | StatePrimitive
  | StateValue[]
  | { readonly [key: string]: StateValue };

export type StateType = 'string' | 'number' | 'boolean' | 'enum' | 'object' | 'array';

export const STATE_TYPES: readonly StateType[] = [
  'string',
  'number',
  'boolean',
  'enum',
  'object',
  'array'
];

export const isStateType = (v: unknown): v is StateType =>
  typeof v === 'string' && (STATE_TYPES as readonly string[]).includes(v);

export const typeOfStateValue = (v: StateValue): StateType | 'null' => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return t;
  return 'object';
};

export const isStateValueAssignableTo = (value: StateValue, type: StateType): boolean => {
  if (value === null) return type !== 'enum'; // null allowed for everything except enum (must pick one)
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'enum':
      return typeof value === 'string';
    case 'object':
      return typeof value === 'object' && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    default:
      // A declared type outside the vocabulary (legacy "list" data written
      // before the type gate existed) can never validate a value. The shape
      // validator names the real problem; this just refuses to guess.
      return false;
  }
};
