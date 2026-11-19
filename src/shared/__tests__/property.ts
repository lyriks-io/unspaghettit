/**
 * Seeded randomized checks for tests, without a dependency: a small PRNG and
 * a runner that tries cases from the smallest size up, so the first failure
 * it reports is the smallest one it met, printed with the seed that rebuilds
 * it. Lives under __tests__, which the package never ships.
 */

/** A deterministic generator of numbers in [0, 1) (mulberry32). */
export const prng = (seed: number) => {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** An integer in [min, max]. */
    int: (min: number, max: number): number => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    chance: (p: number): boolean => next() < p
  };
};

export type Rng = ReturnType<typeof prng>;

/**
 * Check `property` on `runs` cases built by `build(rng, size)`, sizes growing
 * from 1 to `maxSize`. Each case has its own seed, derived from `seed`. The
 * first case that fails throws, naming its seed, its size and the case.
 */
export const forAll = <T>(
  options: { readonly seed: number; readonly runs: number; readonly maxSize: number },
  build: (rng: Rng, size: number) => T,
  property: (input: T) => void
): void => {
  for (let run = 0; run < options.runs; run += 1) {
    const caseSeed = (options.seed * 1_000_003 + run) >>> 0;
    const size = 1 + Math.floor((run * options.maxSize) / options.runs);
    const input = build(prng(caseSeed), size);
    try {
      property(input);
    } catch (error) {
      throw new Error(
        `Property failed on run ${run} (case seed ${caseSeed}, size ${size}):\n${JSON.stringify(input, null, 2)}\n${(error as Error).message}`
      );
    }
  }
};
