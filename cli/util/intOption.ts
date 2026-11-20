import { InvalidArgumentError } from 'commander';

/**
 * A commander parser for a whole-number option. `Number.parseInt` read
 * "ten" as NaN, and a NaN bound weakened the gate without a word: a model
 * check bounded at NaN steps explored the starting state alone, and a
 * scenario failure count compared with NaN never failed. Anything but a
 * whole number of at least `min` is refused, naming what was given.
 */
export const intOption =
  (min: number) =>
  (value: string): number => {
    const trimmed = value.trim();
    const parsed = /^-?\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
    if (!Number.isSafeInteger(parsed) || parsed < min) {
      throw new InvalidArgumentError(`expected a whole number of at least ${min}, got "${value}".`);
    }
    return parsed;
  };
