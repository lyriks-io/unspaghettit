import { sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertSafeSegment,
  isSafeSegment,
  UnsafePathSegmentError,
  featureFilePath,
  projectFilePath,
  statusFilePath,
  provenanceFilePath,
  historyFilePath
} from './snapshotLayout';

/**
 * Regression guard for the arbitrary-file-write class: an attacker-supplied id
 * (e.g. a malicious `.unspa` bundle's `statuses[].featureId`) must never reach
 * `path.join` unescaped and land a sidecar outside the snapshot tree.
 */
describe('path-traversal hardening', () => {
  const ROOT = `${sep}snap`;
  const TRAVERSALS = [
    '../../../../etc/passwd',
    '..\\..\\..\\Windows\\System32\\x',
    'a/b',
    'a\\b',
    '..',
    '.',
    'foo:bar',
    'foo\0bar',
    '%2e%2e%2fetc',
    ''
  ];
  const LEGIT = ['39e57ee0', 'e8300ab2', '3f2b1c9a-1d2e-4a5b-8c7d-9e0f1a2b3c4d', 'my-feature-slug'];

  describe('isSafeSegment / assertSafeSegment', () => {
    it('accepts hex ids, legacy UUIDs, and slugs', () => {
      for (const id of LEGIT) {
        expect(isSafeSegment(id)).toBe(true);
        expect(assertSafeSegment(id)).toBe(id);
      }
    });

    it('rejects every traversal / illegal-char segment', () => {
      for (const bad of TRAVERSALS) {
        expect(isSafeSegment(bad)).toBe(false);
        expect(() => assertSafeSegment(bad)).toThrow(UnsafePathSegmentError);
      }
    });

    it('rejects an over-long segment (DoS / smuggling guard)', () => {
      expect(isSafeSegment('a'.repeat(129))).toBe(false);
    });
  });

  describe('file-path builders reject a poisoned id', () => {
    const evil = '../../../../../../tmp/evil';

    it('statusFilePath', () => {
      expect(() => statusFilePath(ROOT, null, evil)).toThrow(UnsafePathSegmentError);
    });
    it('provenanceFilePath', () => {
      expect(() => provenanceFilePath(ROOT, null, evil)).toThrow(UnsafePathSegmentError);
    });
    it('featureFilePath', () => {
      expect(() => featureFilePath(ROOT, null, evil)).toThrow(UnsafePathSegmentError);
    });
    it('projectFilePath', () => {
      expect(() => projectFilePath(ROOT, evil)).toThrow(UnsafePathSegmentError);
    });
    it('historyFilePath', () => {
      expect(() => historyFilePath(ROOT, null, 'feature', evil)).toThrow(UnsafePathSegmentError);
    });
    it('rejects a poisoned owning-project slug', () => {
      expect(() => statusFilePath(ROOT, '..' + sep + '..', 'e8300ab2')).toThrow(
        UnsafePathSegmentError
      );
    });
  });

  describe('legit ids still build a path inside the tree', () => {
    it('keeps the sidecar under the snapshot root', () => {
      const p = statusFilePath(ROOT, null, 'e8300ab2');
      expect(p.startsWith(ROOT + sep)).toBe(true);
      expect(p.includes('..')).toBe(false);
    });
  });
});
