/**
 * Field types for Entity entities. Broader than `StateType` because Entity is
 * documentation of arbitrary JSON-shaped data. Including dates, timestamps,
 * raw JSON blobs, and the null literal.
 */
export type EntityFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'object'
  | 'array'
  | 'date'
  | 'timestamp'
  | 'null'
  | 'json';

export const ALL_DATA_FIELD_TYPES: readonly EntityFieldType[] = [
  'string',
  'number',
  'boolean',
  'enum',
  'object',
  'array',
  'date',
  'timestamp',
  'null',
  'json'
];

export const dataFieldTypeLabel = (t: EntityFieldType): string => {
  switch (t) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'enum':
      return 'enum';
    case 'object':
      return 'object';
    case 'array':
      return 'array';
    case 'date':
      return 'date';
    case 'timestamp':
      return 'timestamp';
    case 'null':
      return 'null';
    case 'json':
      return 'json';
  }
};

export const dataFieldTypeIsContainer = (t: EntityFieldType): boolean =>
  t === 'object' || t === 'array';
