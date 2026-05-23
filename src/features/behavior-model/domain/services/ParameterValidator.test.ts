import { describe, expect, it } from 'vitest';
import type { Parameter } from '../entities/Parameter';
import { asParameterId } from '../value-objects/ids';
import { validateParameters } from './ParameterValidator';

const param = (overrides: Partial<Parameter> = {}): Parameter => ({
  id: asParameterId('p'),
  name: 'value',
  type: 'string',
  required: true,
  ...overrides
});

describe('validateParameters with zod-style validations', () => {
  it('rejects empty when non_empty validation is set', () => {
    const errors = validateParameters([param({ validations: [{ type: 'non_empty' }] })], {
      value: ''
    });
    expect(errors).toHaveLength(1);
  });

  it('enforces min_length / max_length', () => {
    const p = param({
      validations: [
        { type: 'min_length', value: 3 },
        { type: 'max_length', value: 10 }
      ]
    });
    expect(validateParameters([p], { value: 'ab' })).toHaveLength(1);
    expect(validateParameters([p], { value: 'abc' })).toHaveLength(0);
    expect(validateParameters([p], { value: 'abcdefghijk' })).toHaveLength(1);
  });

  it('enforces email format', () => {
    const p = param({ validations: [{ type: 'email' }] });
    expect(validateParameters([p], { value: 'not-an-email' })).toHaveLength(1);
    expect(validateParameters([p], { value: 'a@b.com' })).toHaveLength(0);
  });

  it('enforces pattern', () => {
    const p = param({ validations: [{ type: 'pattern', value: '^[A-Z]{2,4}$' }] });
    expect(validateParameters([p], { value: 'abc' })).toHaveLength(1);
    expect(validateParameters([p], { value: 'AB' })).toHaveLength(0);
  });

  it('enforces numeric min/max/integer/positive', () => {
    const p = param({
      type: 'number',
      validations: [
        { type: 'min', value: 0 },
        { type: 'max', value: 100 },
        { type: 'integer' },
        { type: 'positive' }
      ]
    });
    expect(validateParameters([p], { value: -1 })).toHaveLength(1);
    expect(validateParameters([p], { value: 50.5 })).toHaveLength(1);
    expect(validateParameters([p], { value: 0 })).toHaveLength(1); // not positive
    expect(validateParameters([p], { value: 50 })).toHaveLength(0);
    expect(validateParameters([p], { value: 101 })).toHaveLength(1);
  });

  it('uses custom message when provided', () => {
    const p = param({
      validations: [{ type: 'min_length', value: 5, message: 'too short' }]
    });
    const errors = validateParameters([p], { value: 'abc' });
    expect(errors[0]?.reason).toBe('too short');
  });

  it('validates UUID format', () => {
    const p = param({ validations: [{ type: 'uuid' }] });
    expect(validateParameters([p], { value: 'not-a-uuid' })).toHaveLength(1);
    expect(
      validateParameters([p], { value: '550e8400-e29b-41d4-a716-446655440000' })
    ).toHaveLength(0);
  });

  it('validates IPv4 address', () => {
    const p = param({ validations: [{ type: 'ipv4' }] });
    expect(validateParameters([p], { value: '999.0.0.1' })).toHaveLength(1);
    expect(validateParameters([p], { value: '192.168.1.1' })).toHaveLength(0);
  });

  it('validates ISO date / datetime / time', () => {
    expect(
      validateParameters([param({ validations: [{ type: 'iso_date' }] })], { value: '2026-13-40' })
    ).toHaveLength(1);
    expect(
      validateParameters([param({ validations: [{ type: 'iso_date' }] })], { value: '2026-05-08' })
    ).toHaveLength(0);
    expect(
      validateParameters([param({ validations: [{ type: 'iso_datetime' }] })], {
        value: '2026-05-08T12:00:00Z'
      })
    ).toHaveLength(0);
    expect(
      validateParameters([param({ validations: [{ type: 'iso_time' }] })], { value: '13:45:00' })
    ).toHaveLength(0);
  });

  it('validates slug, color, semver, json, phone (E.164)', () => {
    expect(
      validateParameters([param({ validations: [{ type: 'slug' }] })], { value: 'hello-world' })
    ).toHaveLength(0);
    expect(
      validateParameters([param({ validations: [{ type: 'slug' }] })], { value: 'Bad Slug' })
    ).toHaveLength(1);
    expect(
      validateParameters([param({ validations: [{ type: 'color_hex' }] })], { value: '#1a2b3c' })
    ).toHaveLength(0);
    expect(
      validateParameters([param({ validations: [{ type: 'semver' }] })], { value: '1.2.3-rc.1' })
    ).toHaveLength(0);
    expect(
      validateParameters([param({ validations: [{ type: 'json' }] })], { value: '{"a":1}' })
    ).toHaveLength(0);
    expect(
      validateParameters([param({ validations: [{ type: 'json' }] })], { value: 'not json' })
    ).toHaveLength(1);
    expect(
      validateParameters([param({ validations: [{ type: 'phone_e164' }] })], {
        value: '+33612345678'
      })
    ).toHaveLength(0);
  });

  it('validates string shape (starts_with / ends_with / contains / length / lowercase)', () => {
    expect(
      validateParameters([param({ validations: [{ type: 'starts_with', value: 'foo' }] })], {
        value: 'football'
      })
    ).toHaveLength(0);
    expect(
      validateParameters([param({ validations: [{ type: 'ends_with', value: 'bar' }] })], {
        value: 'foobar'
      })
    ).toHaveLength(0);
    expect(
      validateParameters([param({ validations: [{ type: 'contains', value: 'oo' }] })], {
        value: 'foobar'
      })
    ).toHaveLength(0);
    expect(
      validateParameters([param({ validations: [{ type: 'length', value: 4 }] })], {
        value: 'four'
      })
    ).toHaveLength(0);
    expect(
      validateParameters([param({ validations: [{ type: 'length', value: 5 }] })], {
        value: 'four'
      })
    ).toHaveLength(1);
    expect(
      validateParameters([param({ validations: [{ type: 'lowercase' }] })], { value: 'Hello' })
    ).toHaveLength(1);
    expect(
      validateParameters([param({ validations: [{ type: 'no_whitespace' }] })], {
        value: 'with space'
      })
    ).toHaveLength(1);
  });

  it('validates number ranges (multiple_of / non_negative / safe_integer)', () => {
    expect(
      validateParameters(
        [param({ type: 'number', validations: [{ type: 'multiple_of', value: 5 }] })],
        { value: 15 }
      )
    ).toHaveLength(0);
    expect(
      validateParameters(
        [param({ type: 'number', validations: [{ type: 'multiple_of', value: 5 }] })],
        { value: 11 }
      )
    ).toHaveLength(1);
    expect(
      validateParameters(
        [param({ type: 'number', validations: [{ type: 'non_negative' }] })],
        { value: 0 }
      )
    ).toHaveLength(0);
    expect(
      validateParameters(
        [param({ type: 'number', validations: [{ type: 'non_negative' }] })],
        { value: -1 }
      )
    ).toHaveLength(1);
    expect(
      validateParameters(
        [param({ type: 'number', validations: [{ type: 'safe_integer' }] })],
        { value: Number.MAX_SAFE_INTEGER + 2 }
      )
    ).toHaveLength(1);
  });
});
