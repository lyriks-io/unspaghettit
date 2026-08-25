import { describe, expect, it } from 'vitest';
import { isEmbedded, isLyriksBrand } from './hostBrand';

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

describe('isEmbedded', () => {
  it('is true only when the host frames the dashboard with embed=1', () => {
    expect(isEmbedded(url('?embed=1'))).toBe(true);
    expect(isEmbedded(url('?embed=1&brand=lyriks&user=Ada'))).toBe(true);
  });

  // A host link opened in a NEW TAB carries the brand but not the frame, and
  // still needs the dashboard's own chrome.
  it('is false for a branded link that is not framed', () => {
    expect(isEmbedded(url('?brand=lyriks'))).toBe(false);
    expect(isEmbedded(url('?embed=0'))).toBe(false);
    expect(isEmbedded(url())).toBe(false);
    expect(isEmbedded(null)).toBe(false);
  });
});
