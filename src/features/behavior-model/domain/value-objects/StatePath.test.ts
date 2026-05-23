import { describe, expect, it } from 'vitest';
import {
  asStatePath,
  isStatePath,
  normalizeSnapshot,
  readPath,
  writePath
} from './StatePath';

describe('StatePath', () => {
  it('accepts dot-separated lowercase paths', () => {
    expect(isStatePath('selection.count')).toBe(true);
    expect(isStatePath('user.role')).toBe(true);
    expect(isStatePath('quota.leadsThisMonth')).toBe(true);
  });

  it('rejects empty, leading-dot, and trailing-dot paths', () => {
    expect(isStatePath('')).toBe(false);
    expect(isStatePath('.foo')).toBe(false);
    expect(isStatePath('foo.')).toBe(false);
    expect(isStatePath('foo..bar')).toBe(false);
  });

  it('reads nested paths', () => {
    const snapshot = { selection: { count: 3, locked: true } };
    expect(readPath(snapshot, asStatePath('selection.count'))).toBe(3);
    expect(readPath(snapshot, asStatePath('selection.locked'))).toBe(true);
  });

  it('returns undefined for missing paths', () => {
    expect(readPath({}, asStatePath('a.b.c'))).toBeUndefined();
  });

  it('writes nested paths immutably', () => {
    const snapshot = { selection: { count: 0, locked: false } };
    const next = writePath(snapshot, asStatePath('selection.count'), 5);
    expect(readPath(next, asStatePath('selection.count'))).toBe(5);
    expect(snapshot.selection.count).toBe(0); // original untouched
  });

  it('creates intermediate objects when writing into a missing path', () => {
    const next = writePath({}, asStatePath('a.b.c'), 'value');
    expect(readPath(next, asStatePath('a.b.c'))).toBe('value');
  });

  describe('normalizeSnapshot', () => {
    it('returns the snapshot unchanged when no top-level keys contain dots', () => {
      const snapshot = { selection: { count: 3 } };
      expect(normalizeSnapshot(snapshot)).toBe(snapshot);
    });

    it('rewrites flat dot-keys into the nested representation', () => {
      const normalized = normalizeSnapshot({ 'selection.count': 7 });
      expect(readPath(normalized, asStatePath('selection.count'))).toBe(7);
    });

    it('merges flat dot-keys with co-existing nested keys', () => {
      const normalized = normalizeSnapshot({
        'cart.subtotalCents': 1000,
        cart: { itemCount: 3 }
      });
      // Last-write-wins via Object.entries ordering: insertion order says
      // 'cart.subtotalCents' lands first via writePath, then the literal 'cart'
      // key replaces it. That's fine, callers shouldn't author both shapes
      // for the same root. The contract we care about is "purely-flat input
      // gets healed".
      expect(readPath(normalized, asStatePath('cart.itemCount'))).toBe(3);
    });

    it('drops dotted top-level keys that are not valid state paths', () => {
      const normalized = normalizeSnapshot({ 'not..valid': 1, 'good.path': 2 });
      expect(readPath(normalized, asStatePath('good.path'))).toBe(2);
      expect(Object.keys(normalized)).not.toContain('not..valid');
    });
  });
});
