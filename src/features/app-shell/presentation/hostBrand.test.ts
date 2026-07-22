import { describe, expect, it } from 'vitest';
import { isLyriksBrand } from './hostBrand';

const url = (search = '') => new URL(`https://example.test/projects${search}`);

describe('isLyriksBrand', () => {
  it('is true only when the host sets brand=lyriks', () => {
    expect(isLyriksBrand(url('?brand=lyriks'))).toBe(true);
    expect(isLyriksBrand(url('?embed=1&brand=lyriks&user=Ada'))).toBe(true);
  });

  it('is false for a standalone install', () => {
    expect(isLyriksBrand(url())).toBe(false);
    expect(isLyriksBrand(url('?embed=1'))).toBe(false);
    expect(isLyriksBrand(url('?brand=unspaghettit'))).toBe(false);
    expect(isLyriksBrand(null)).toBe(false);
  });

  // The regression this exists for: the Lyriks SKIN is the default theme since
  // 0.7.0, so anything keying host-detection off the theme is true for nearly
  // every user. That is what hid the Expert/Builder switcher from every
  // standalone install until it was regated on this predicate.
  it('does not depend on the active theme', () => {
    expect(isLyriksBrand(url('?theme=lyriks'))).toBe(false);
  });
});
