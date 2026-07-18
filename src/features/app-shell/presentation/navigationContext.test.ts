import { describe, expect, it } from 'vitest';
import {
  copyPersistentNavigationParams,
  withPersistentNavigationParams
} from './navigationContext';

describe('persistent navigation context', () => {
  it('carries every global host parameter but not page-local state', () => {
    const current = new URL(
      'https://example.test/features/one?embed=1&user=Ada&brand=lyriks&tab=states&focus=row'
    );
    const destination = new URL('https://example.test/projects?panel=history');

    expect(withPersistentNavigationParams(current, destination).searchParams.toString()).toBe(
      'panel=history&embed=1&user=Ada&brand=lyriks'
    );
  });

  it('respects an explicit value selected by the destination', () => {
    const current = new URL('https://example.test/projects?brand=lyriks&embed=1');
    const destination = new URL('https://example.test/features?brand=unspaghettit');

    expect(withPersistentNavigationParams(current, destination).searchParams.toString()).toBe(
      'brand=unspaghettit&embed=1'
    );
  });

  it('can preserve context while a page rebuilds its own query string', () => {
    const source = new URLSearchParams('embed=1&user=Ada&brand=lyriks&surface=checkout');
    const destination = new URLSearchParams('tab=states');

    expect(copyPersistentNavigationParams(source, destination).toString()).toBe(
      'tab=states&embed=1&user=Ada&brand=lyriks'
    );
  });
});
