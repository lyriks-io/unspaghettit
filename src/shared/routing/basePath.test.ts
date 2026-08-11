import { describe, it, expect } from 'vitest';
import { normalizeBasePath, prependBase, stripBase, stripBaseFromRequestUrl } from './basePath';

describe('normalizeBasePath', () => {
  it('maps unset/empty/root to no prefix', () => {
    expect(normalizeBasePath(undefined)).toBe('');
    expect(normalizeBasePath(null)).toBe('');
    expect(normalizeBasePath('')).toBe('');
    expect(normalizeBasePath('   ')).toBe('');
    expect(normalizeBasePath('/')).toBe('');
    expect(normalizeBasePath('//')).toBe('');
  });

  it('normalizes shape: leading slash on, trailing slash off, duplicates collapsed', () => {
    expect(normalizeBasePath('behavior')).toBe('/behavior');
    expect(normalizeBasePath('/behavior')).toBe('/behavior');
    expect(normalizeBasePath('/behavior/')).toBe('/behavior');
    expect(normalizeBasePath('behavior/')).toBe('/behavior');
    expect(normalizeBasePath('//behavior//')).toBe('/behavior');
    expect(normalizeBasePath(' /behavior ')).toBe('/behavior');
    expect(normalizeBasePath('/tools/unspa')).toBe('/tools/unspa');
  });

  it('fails closed to no prefix on anything suspicious', () => {
    expect(normalizeBasePath('/behavior editor')).toBe('');
    expect(normalizeBasePath('/beh%61vior')).toBe('');
    expect(normalizeBasePath('/../etc')).toBe('');
    expect(normalizeBasePath('/a/../b')).toBe('');
    expect(normalizeBasePath('/a/./b')).toBe('');
    expect(normalizeBasePath('/<script>')).toBe('');
    expect(normalizeBasePath('/beh"avior')).toBe('');
  });
});

describe('prependBase', () => {
  it('is the identity with no base', () => {
    expect(prependBase('', '/projects')).toBe('/projects');
    expect(prependBase('', '/')).toBe('/');
  });

  it('prefixes app-rooted paths, mapping / to the base itself', () => {
    expect(prependBase('/behavior', '/projects')).toBe('/behavior/projects');
    expect(prependBase('/behavior', '/api/sync/events?token=x')).toBe(
      '/behavior/api/sync/events?token=x'
    );
    expect(prependBase('/behavior', '/')).toBe('/behavior');
  });
});

describe('stripBase', () => {
  it('is the identity with no base', () => {
    expect(stripBase('', '/behavior/projects')).toBe('/behavior/projects');
  });

  it('strips the base and maps the bare base to /', () => {
    expect(stripBase('/behavior', '/behavior/projects/x')).toBe('/projects/x');
    expect(stripBase('/behavior', '/behavior')).toBe('/');
  });

  it('leaves unprefixed and sibling paths untouched', () => {
    expect(stripBase('/behavior', '/projects/x')).toBe('/projects/x');
    // A sibling that merely shares the prefix string is NOT under the base.
    expect(stripBase('/behavior', '/behaviorish')).toBe('/behaviorish');
  });
});

describe('stripBaseFromRequestUrl', () => {
  it('handles the query-only form a pathname never has', () => {
    expect(stripBaseFromRequestUrl('/behavior', '/behavior?embed=1')).toBe('/?embed=1');
    expect(stripBaseFromRequestUrl('/behavior', '/behavior/api/projects?x=1')).toBe(
      '/api/projects?x=1'
    );
    expect(stripBaseFromRequestUrl('/behavior', '/behavior')).toBe('/');
    expect(stripBaseFromRequestUrl('/behavior', '/api/projects')).toBe('/api/projects');
    expect(stripBaseFromRequestUrl('', '/behavior/api')).toBe('/behavior/api');
  });
});
