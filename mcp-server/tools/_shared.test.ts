import { describe, expect, it } from 'vitest';
import { coerceScalarByType } from './_shared';

describe('coerceScalarByType', () => {
  it('passes already-typed values through untouched', () => {
    expect(coerceScalarByType(0, 'number')).toBe(0);
    expect(coerceScalarByType(true, 'boolean')).toBe(true);
    expect(coerceScalarByType([1, 2], 'array')).toEqual([1, 2]);
    expect(coerceScalarByType({ a: 1 }, 'object')).toEqual({ a: 1 });
  });

  it('parses numeric strings when the declared type is number', () => {
    expect(coerceScalarByType('0', 'number')).toBe(0);
    expect(coerceScalarByType('-3.14', 'number')).toBe(-3.14);
    expect(coerceScalarByType('1e3', 'number')).toBe(1000);
  });

  it('keeps non-numeric strings as-is for number so the validator can complain', () => {
    expect(coerceScalarByType('abc', 'number')).toBe('abc');
    expect(coerceScalarByType('', 'number')).toBe('');
    expect(coerceScalarByType('NaN', 'number')).toBe('NaN');
  });

  it('parses boolean string literals when the declared type is boolean', () => {
    expect(coerceScalarByType('true', 'boolean')).toBe(true);
    expect(coerceScalarByType('false', 'boolean')).toBe(false);
  });

  it('keeps other strings as-is for boolean (no 0/1 coercion to avoid ambiguity)', () => {
    expect(coerceScalarByType('yes', 'boolean')).toBe('yes');
    expect(coerceScalarByType('1', 'boolean')).toBe('1');
  });

  it('parses JSON when the declared type is array or object', () => {
    expect(coerceScalarByType('[1,2,3]', 'array')).toEqual([1, 2, 3]);
    expect(coerceScalarByType('{"a":1}', 'object')).toEqual({ a: 1 });
  });

  it('preserves the original string when JSON parse fails', () => {
    expect(coerceScalarByType('not json', 'array')).toBe('not json');
  });

  it('returns null and undefined unchanged', () => {
    expect(coerceScalarByType(null, 'number')).toBeNull();
    expect(coerceScalarByType(undefined, 'number')).toBeUndefined();
  });

  it('leaves strings alone for string/enum/format types', () => {
    expect(coerceScalarByType('hello', 'string')).toBe('hello');
    expect(coerceScalarByType('red', 'enum')).toBe('red');
    expect(coerceScalarByType('2026-01-01', 'date')).toBe('2026-01-01');
  });
});
