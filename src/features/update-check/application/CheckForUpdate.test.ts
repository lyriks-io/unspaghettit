import { describe, expect, it } from 'vitest';
import type { CachedVersionCheck, VersionCache } from './ports/VersionCache';
import type { VersionRegistry } from './ports/VersionRegistry';
import {
  cachedUpdateStatus,
  checkForUpdateUseCase,
  DEFAULT_TTL_MS
} from './CheckForUpdate';

const memoryCache = (seed: CachedVersionCheck | null = null) => {
  let store = seed;
  const cache: VersionCache = {
    read: () => store,
    write: (entry) => {
      store = entry;
    }
  };
  return { cache, peek: () => store };
};

const countingRegistry = (latest: string | null): VersionRegistry & { calls: () => number } => {
  let calls = 0;
  return {
    calls: () => calls,
    fetchLatest: async () => {
      calls += 1;
      return latest;
    }
  };
};

const PKG = 'unspaghettit';

describe('checkForUpdateUseCase', () => {
  it('fetches when the cache is empty and reports an available update', async () => {
    const { cache, peek } = memoryCache();
    const registry = countingRegistry('0.9.0');
    const check = checkForUpdateUseCase({ registry, cache, now: () => 1000 });

    const status = await check({ current: '0.8.0', packageName: PKG });

    expect(status).toEqual({ current: '0.8.0', latest: '0.9.0', updateAvailable: true });
    expect(registry.calls()).toBe(1);
    // Refresh persisted the result with the current clock.
    expect(peek()).toEqual({ latest: '0.9.0', checkedAt: 1000 });
  });

  it('serves a fresh cache without hitting the registry', async () => {
    const { cache } = memoryCache({ latest: '0.9.0', checkedAt: 1000 });
    const registry = countingRegistry('1.0.0');
    const check = checkForUpdateUseCase({ registry, cache, now: () => 1000 + DEFAULT_TTL_MS - 1 });

    const status = await check({ current: '0.8.0', packageName: PKG });

    expect(status.latest).toBe('0.9.0'); // cached, not the registry's 1.0.0
    expect(registry.calls()).toBe(0);
  });

  it('refreshes once the cache is older than the TTL', async () => {
    const { cache, peek } = memoryCache({ latest: '0.9.0', checkedAt: 1000 });
    const registry = countingRegistry('1.0.0');
    const check = checkForUpdateUseCase({ registry, cache, now: () => 1000 + DEFAULT_TTL_MS + 1 });

    const status = await check({ current: '0.8.0', packageName: PKG });

    expect(status.latest).toBe('1.0.0');
    expect(registry.calls()).toBe(1);
    expect(peek()?.latest).toBe('1.0.0');
  });

  it('forceRefresh bypasses a still-fresh cache', async () => {
    const { cache } = memoryCache({ latest: '0.9.0', checkedAt: 1000 });
    const registry = countingRegistry('1.0.0');
    const check = checkForUpdateUseCase({ registry, cache, now: () => 1000 });

    const status = await check({ current: '0.8.0', packageName: PKG, forceRefresh: true });

    expect(status.latest).toBe('1.0.0');
    expect(registry.calls()).toBe(1);
  });

  it('falls back to the cached latest when the refresh fails', async () => {
    const { cache } = memoryCache({ latest: '0.9.0', checkedAt: 1000 });
    const registry = countingRegistry(null); // offline
    const check = checkForUpdateUseCase({ registry, cache, now: () => 1000 + DEFAULT_TTL_MS + 1 });

    const status = await check({ current: '0.8.0', packageName: PKG });

    expect(status).toEqual({ current: '0.8.0', latest: '0.9.0', updateAvailable: true });
    expect(registry.calls()).toBe(1);
  });

  it('is disabled: never touches the registry and reports unknown', async () => {
    const { cache } = memoryCache({ latest: '0.9.0', checkedAt: 1000 });
    const registry = countingRegistry('1.0.0');
    const check = checkForUpdateUseCase({ registry, cache, now: () => 1000, disabled: true });

    const status = await check({ current: '0.8.0', packageName: PKG });

    expect(status).toEqual({ current: '0.8.0', latest: null, updateAvailable: false });
    expect(registry.calls()).toBe(0);
  });
});

describe('cachedUpdateStatus', () => {
  it('derives the status from the cache with no network', () => {
    const { cache } = memoryCache({ latest: '0.9.0', checkedAt: 1000 });
    expect(cachedUpdateStatus({ cache }, { current: '0.8.0' })).toEqual({
      current: '0.8.0',
      latest: '0.9.0',
      updateAvailable: true
    });
  });

  it('reports unknown for an empty cache or when disabled', () => {
    const empty = memoryCache();
    expect(cachedUpdateStatus({ cache: empty.cache }, { current: '0.8.0' })).toEqual({
      current: '0.8.0',
      latest: null,
      updateAvailable: false
    });
    const seeded = memoryCache({ latest: '0.9.0', checkedAt: 1000 });
    expect(cachedUpdateStatus({ cache: seeded.cache, disabled: true }, { current: '0.8.0' })).toEqual({
      current: '0.8.0',
      latest: null,
      updateAvailable: false
    });
  });
});
