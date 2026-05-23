import { describe, expect, it } from 'vitest';
import { expandShortId } from './short-ids';

describe('expandShortId', () => {
  const candidates = [
    '6aaa42a2-7c6c-4996-811f-0ccb72adc6c3',
    'cc3555b5-c856-4b18-b5ff-813f10b73e80',
    'bbe214f8-cab1-40e3-a2b7-b8e1267d622f',
    'be9f417c-7ee9-455a-91c4-614b846658e5',
    'a1b2c3d4'
  ];

  it('returns the input when it already matches an existing id exactly', () => {
    expect(expandShortId('a1b2c3d4', candidates, 'id')).toBe('a1b2c3d4');
    expect(expandShortId(candidates[0]!, candidates, 'id')).toBe(candidates[0]);
  });

  it('expands a unique prefix to its full match', () => {
    expect(expandShortId('6aaa42a2', candidates, 'id')).toBe(candidates[0]);
    expect(expandShortId('cc35', candidates, 'id')).toBe(candidates[1]);
  });

  it('throws on ambiguous prefix', () => {
    expect(() => expandShortId('b', candidates, 'id')).toThrow(/Ambiguous/);
  });

  it('passes through hex prefixes with no match', () => {
    expect(expandShortId('deadbeef', candidates, 'id')).toBe('deadbeef');
  });

  it('passes through non-hex strings unchanged', () => {
    expect(expandShortId('nope', candidates, 'id')).toBe('nope');
    expect(expandShortId('id_legacy', candidates, 'id')).toBe('id_legacy');
  });

  it('throws on empty input', () => {
    expect(() => expandShortId('', candidates, 'featureId')).toThrow(/Empty featureId/);
  });
});
