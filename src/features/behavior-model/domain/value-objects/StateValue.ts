export type StatePrimitive = string | number | boolean | null;

export type StateValue =
  | StatePrimitive
  | StateValue[]
  | { readonly [key: string]: StateValue };

export type StateType = 'string' | 'number' | 'boolean' | 'enum' | 'object' | 'array';

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
  }
};
