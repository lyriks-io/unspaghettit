import type { StateType } from './StateValue';

/**
 * Action parameters cover the full breadth of "ask the user / agent for
 * a value": text inputs, datetime pickers, lat/lng, enum dropdowns, etc.
 *
 * The simulator engine and StateDefinitions still operate on a smaller set of
 * runtime shapes (`StateType`). Date, time, timestamp, url, email all live
 * as `string` once persisted; geolocation lives as `object`. The widening
 * stays at the parameter / UI level so the engine's invariant checks don't
 * have to grow.
 */
export const PARAMETER_FORMAT_TYPES = [
  'date',
  'time',
  'timestamp',
  'url',
  'email',
  'geolocation'
] as const;

export type ParameterFormatType = (typeof PARAMETER_FORMAT_TYPES)[number];

export type ParameterType = StateType | ParameterFormatType;

export const PARAMETER_TYPES: readonly ParameterType[] = [
  'string',
  'number',
  'boolean',
  'enum',
  'object',
  'array',
  ...PARAMETER_FORMAT_TYPES
];

/**
 * Collapse a parameter-level type to the runtime shape used by the simulator
 * engine, validators, and StateDefinitions. Strings cover date/time/timestamp/
 * url/email; geolocation lives as an object `{ lat, lng }`.
 */
export const parameterTypeToStateType = (type: ParameterType): StateType => {
  switch (type) {
    case 'date':
    case 'time':
    case 'timestamp':
    case 'url':
    case 'email':
      return 'string';
    case 'geolocation':
      return 'object';
    default:
      return type;
  }
};

export const isParameterType = (v: unknown): v is ParameterType =>
  typeof v === 'string' && (PARAMETER_TYPES as readonly string[]).includes(v);
