import { describe, expect, it } from 'vitest';
import { coerceDefaultValue } from './StateValueCoercion';

describe('coerceDefaultValue', () => {
  it('returns numbers untouched', () => {
    const r = coerceDefaultValue(365, 'number');
    expect(r).toEqual({ value: 365, changed: false });
  });

  it('parses JSON-stringified numbers', () => {
    const r = coerceDefaultValue('365', 'number');
    expect(r).toEqual({ value: 365, changed: true });
  });

  it('parses JSON-stringified booleans', () => {
    expect(coerceDefaultValue('true', 'boolean')).toEqual({ value: true, changed: true });
    expect(coerceDefaultValue('false', 'boolean')).toEqual({ value: false, changed: true });
  });

  it('returns booleans untouched', () => {
    expect(coerceDefaultValue(false, 'boolean')).toEqual({ value: false, changed: false });
    expect(coerceDefaultValue(true, 'boolean')).toEqual({ value: true, changed: false });
  });

  it('keeps a clean string default unchanged', () => {
    const r = coerceDefaultValue('helper', 'string');
    expect(r).toEqual({ value: 'helper', changed: false });
  });

  it('does NOT strip quote chars from a type=string default. Strings are taken at face value', () => {
    // Ambiguous: the user might genuinely want a literal `"helper"` (with
    // embedded quotes). Coercion is for type-mismatch rescue, not for
    // second-guessing well-formed inputs.
    const r = coerceDefaultValue('"helper"', 'string');
    expect(r).toEqual({ value: '"helper"', changed: false });
  });

  it('strips JSON-encoding from enum defaults and validates against enumValues', () => {
    const r = coerceDefaultValue('"helper"', 'enum', ['bride', 'groom', 'helper']);
    expect(r).toEqual({ value: 'helper', changed: true });
  });

  it('falls back to the first enum value when the default is not a member', () => {
    const r = coerceDefaultValue('unknown', 'enum', ['bride', 'groom', 'helper']);
    expect(r).toEqual({ value: 'bride', changed: true });
  });

  it('falls back to type-zero when the input is irrecoverable', () => {
    expect(coerceDefaultValue({ weird: 'object' }, 'number').value).toBe(0);
    expect(coerceDefaultValue([], 'boolean').value).toBe(false);
  });

  it('round-trips object/array defaults', () => {
    const obj = { a: 1 };
    const arr = [1, 2, 3];
    expect(coerceDefaultValue(obj, 'object')).toEqual({ value: obj, changed: false });
    expect(coerceDefaultValue(arr, 'array')).toEqual({ value: arr, changed: false });
  });

  it('parses a JSON-stringified object/array', () => {
    expect(coerceDefaultValue('{"a":1}', 'object')).toEqual({ value: { a: 1 }, changed: true });
    expect(coerceDefaultValue('[1,2]', 'array')).toEqual({ value: [1, 2], changed: true });
  });
});
