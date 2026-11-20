import { InvalidArgumentError } from 'commander';
import { describe, expect, it } from 'vitest';
import { intOption } from './intOption';

describe('intOption', () => {
  it('reads a whole number at or above the minimum', () => {
    expect(intOption(1)('6')).toBe(6);
    expect(intOption(0)(' 0 ')).toBe(0);
  });

  it('refuses what is not a whole number instead of reading NaN', () => {
    for (const given of ['ten', '', '5k', '2.5', '1e3']) {
      expect(() => intOption(0)(given)).toThrow(InvalidArgumentError);
    }
  });

  it('refuses a number under the minimum', () => {
    expect(() => intOption(1)('0')).toThrow('expected a whole number of at least 1, got "0".');
    expect(() => intOption(0)('-1')).toThrow(InvalidArgumentError);
  });
});
