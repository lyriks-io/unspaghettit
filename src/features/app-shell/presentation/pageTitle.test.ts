import { describe, expect, it } from 'vitest';
import { brandTitle, LYRIKS_TITLE, pageTitle, UNSPAGHETTIT_TITLE } from './pageTitle';

const url = (search = '') => new URL(`https://example.test/projects/abc${search}`);

describe('brandTitle', () => {
  it('defaults to the Unspaghettit product name', () => {
    expect(brandTitle(url())).toBe(UNSPAGHETTIT_TITLE);
    expect(brandTitle(url('?embed=1'))).toBe(UNSPAGHETTIT_TITLE);
  });

  it('switches to the Lyriks product name under brand=lyriks', () => {
    expect(brandTitle(url('?brand=lyriks'))).toBe(LYRIKS_TITLE);
    expect(brandTitle(url('?embed=1&brand=lyriks&user=Ada'))).toBe(LYRIKS_TITLE);
  });

  it('ignores any other brand value rather than inventing a name', () => {
    expect(brandTitle(url('?brand=acme'))).toBe(UNSPAGHETTIT_TITLE);
    expect(brandTitle(url('?brand=unspaghettit'))).toBe(UNSPAGHETTIT_TITLE);
  });

  it('tolerates a missing url (first paint, SSR)', () => {
    expect(brandTitle(null)).toBe(UNSPAGHETTIT_TITLE);
    expect(brandTitle(undefined)).toBe(UNSPAGHETTIT_TITLE);
  });
});

describe('pageTitle', () => {
  it('puts the product name last', () => {
    expect(pageTitle(url(), 'Projects')).toBe(`Projects / ${UNSPAGHETTIT_TITLE}`);
    expect(pageTitle(url('?brand=lyriks'), 'Projects')).toBe(`Projects / ${LYRIKS_TITLE}`);
  });

  it('leads with the entity name so open tabs are distinguishable', () => {
    expect(pageTitle(url('?brand=lyriks'), 'Checkout', 'Project')).toBe(
      `Checkout / Project / ${LYRIKS_TITLE}`
    );
  });

  it('drops parts that have not loaded yet instead of leaving a stray separator', () => {
    expect(pageTitle(url(), undefined, 'Project')).toBe(`Project / ${UNSPAGHETTIT_TITLE}`);
    expect(pageTitle(url(), null, '  ', 'Feature')).toBe(`Feature / ${UNSPAGHETTIT_TITLE}`);
  });

  it('falls back to the product name alone when nothing else is known', () => {
    expect(pageTitle(url('?brand=lyriks'))).toBe(LYRIKS_TITLE);
  });
});
