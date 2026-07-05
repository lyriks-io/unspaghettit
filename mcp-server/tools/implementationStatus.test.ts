import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildExpectedIndexKeys, findOrphanKeys, healIndexLines } from './implementationStatus';
import type { BehavioralIndex } from '../repo-link';

const writeFixture = (root: string, relPath: string, content: string): void => {
  const abs = join(root, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf8');
};

describe('healIndexLines', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'unspa-heal-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('rewrites the line number when the signature has shifted past the freshness window', () => {
    // Prepend 5 blank lines so the signature lands at line 8 instead of 1.
    writeFixture(
      root,
      'store.ts',
      '\n\n\n\n\n\nclass GraphStore {\n  scope = $state(0);\n}\n'
    );
    const index: BehavioralIndex = {
      'action:foo': {
        status: 'implemented',
        file: 'store.ts',
        line: 1,
        signature: 'class GraphStore {'
      }
    };
    const { healed, nextIndex } = healIndexLines(index, root, new Map());
    expect(healed).toHaveLength(1);
    expect(healed[0]).toMatchObject({
      key: 'action:foo',
      file: 'store.ts',
      previousLine: 1,
      line: 7
    });
    expect(nextIndex['action:foo']?.line).toBe(7);
  });

  it('leaves entries alone when the signature is at the indexed line', () => {
    writeFixture(root, 'store.ts', 'class GraphStore {\n}\n');
    const index: BehavioralIndex = {
      'action:foo': {
        status: 'implemented',
        file: 'store.ts',
        line: 1,
        signature: 'class GraphStore {'
      }
    };
    const { healed, nextIndex } = healIndexLines(index, root, new Map());
    expect(healed).toHaveLength(0);
    expect(nextIndex['action:foo']?.line).toBe(1);
  });

  it('tolerates a small drift (±2 lines) without healing', () => {
    writeFixture(root, 'store.ts', '\n\nclass GraphStore {\n}\n');
    const index: BehavioralIndex = {
      'action:foo': {
        status: 'implemented',
        file: 'store.ts',
        line: 1,
        signature: 'class GraphStore {'
      }
    };
    const { healed } = healIndexLines(index, root, new Map());
    // Signature now at line 3, indexed at 1 → drift 2 → still within window.
    expect(healed).toHaveLength(0);
  });

  it('skips missing entries and entries without signatures', () => {
    writeFixture(root, 'store.ts', '\n\n\n\nfoo()\n');
    const index: BehavioralIndex = {
      'a': { status: 'missing', file: 'store.ts', line: 1, signature: 'foo()' },
      'b': { status: 'implemented', file: 'store.ts', line: 1, signature: '' }
    };
    const { healed } = healIndexLines(index, root, new Map());
    expect(healed).toHaveLength(0);
  });

  it('skips entries whose file cannot be read', () => {
    const index: BehavioralIndex = {
      'a': {
        status: 'implemented',
        file: 'does-not-exist.ts',
        line: 1,
        signature: 'class Foo {'
      }
    };
    const { healed } = healIndexLines(index, root, new Map());
    expect(healed).toHaveLength(0);
  });

  it('skips entries whose signature is no longer in the file (unhealable)', () => {
    writeFixture(root, 'store.ts', 'class Bar {\n}\n');
    const index: BehavioralIndex = {
      'a': {
        status: 'implemented',
        file: 'store.ts',
        line: 1,
        signature: 'class GoneForever {'
      }
    };
    const { healed, nextIndex } = healIndexLines(index, root, new Map());
    expect(healed).toHaveLength(0);
    expect(nextIndex['a']?.line).toBe(1);
  });
});

const indexEntry = (file = 'foo.ts'): BehavioralIndex[string] => ({
  status: 'implemented',
  file,
  line: 1,
  signature: 'x'
});

describe('findOrphanKeys', () => {
  it('returns empty when every index key is in the spec', () => {
    const index: BehavioralIndex = {
      'action:a1b2c3d4': indexEntry(),
      'surface:deadbeef': indexEntry()
    };
    const expected = new Set(['action:a1b2c3d4', 'surface:deadbeef']);
    expect(findOrphanKeys(index, expected)).toEqual([]);
  });

  it('flags a slug-shaped action key with a targeted hint about hex ids', () => {
    const index: BehavioralIndex = {
      'action:add-to-cart': indexEntry()
    };
    const expected = new Set(['action:a1b2c3d4']);
    const orphans = findOrphanKeys(index, expected);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]?.key).toBe('action:add-to-cart');
    expect(orphans[0]?.hint).toMatch(/8-char hex/);
    expect(orphans[0]?.hint).toMatch(/get_behavioral_index|get_feature/);
  });

  it('flags slug-shaped keys for every id-keyed type', () => {
    const index: BehavioralIndex = {
      'surface:checkout': indexEntry(),
      'rule:must-be-logged-in': indexEntry(),
      'invariant:cart-not-empty': indexEntry(),
      'transition:idle-to-loading': indexEntry(),
      'surface_rule:gate': indexEntry(),
      'surface_invariant:visible': indexEntry(),
      'entity:user-account': indexEntry()
    };
    const orphans = findOrphanKeys(index, new Set());
    expect(orphans).toHaveLength(7);
    for (const o of orphans) {
      expect(o.hint).toMatch(/8-char hex/);
    }
  });

  it('does NOT demand hex for event names or state paths', () => {
    const index: BehavioralIndex = {
      'event:UserSignedIn': indexEntry(),
      'state:cart.itemCount': indexEntry()
    };
    const orphans = findOrphanKeys(index, new Set());
    expect(orphans).toHaveLength(2);
    for (const o of orphans) {
      // Should fall through to the generic "not found in spec" hint —
      // event names and state paths legitimately are not hex.
      expect(o.hint).not.toMatch(/8-char hex/);
      expect(o.hint).toMatch(/not found in any feature spec/i);
    }
  });

  it('accepts 36-char legacy UUIDs as valid id-portion shape', () => {
    const index: BehavioralIndex = {
      'action:11111111-2222-3333-4444-555555555555': indexEntry()
    };
    const orphans = findOrphanKeys(index, new Set());
    expect(orphans).toHaveLength(1);
    // Generic "not found in spec" — the id shape is fine, but the spec
    // doesn't have a matching entity (likely removed or wrong feature).
    expect(orphans[0]?.hint).toMatch(/not found in any feature spec/i);
    expect(orphans[0]?.hint).not.toMatch(/8-char hex/);
  });

  it('flags a key with no colon separator at all', () => {
    const index: BehavioralIndex = { 'just-a-slug': indexEntry() };
    const orphans = findOrphanKeys(index, new Set());
    expect(orphans).toHaveLength(1);
    expect(orphans[0]?.hint).toMatch(/no `:` separator/);
  });

  it('does not flag expected keys even when their id portion looks slug-like', () => {
    // event names are expected to be non-hex; the spec uses them verbatim
    // as the id portion of `event:` keys.
    const index: BehavioralIndex = {
      'event:UserSignedIn': indexEntry()
    };
    const expected = new Set(['event:UserSignedIn']);
    expect(findOrphanKeys(index, expected)).toEqual([]);
  });
});

describe('buildExpectedIndexKeys', () => {
  it('accepts every documented key form, not just what coverage reports consume', () => {
    const feature = {
      id: 'f1',
      name: 'Cart',
      surfaces: [
        {
          id: 'surf1',
          name: 'Checkout',
          type: 'screen',
          stateDefinitions: [{ id: 'sd1', path: 'cart.itemCount', type: 'number', defaultValue: 0 }],
          rules: [{ id: 'sr1' }],
          invariants: [{ id: 'si1' }],
          transitions: [{ id: 'st1', target: 'surf1' }],
          actions: [
            {
              id: 'act1',
              name: 'Add To Cart',
              rules: [{ id: 'ar1' }],
              invariants: [{ id: 'ai1' }],
              transitions: [{ id: 'at1', target: 'surf1' }],
              emittedEvents: ['cart.updated']
            }
          ]
        }
      ],
      entities: [{ id: 'en1', namespace: 'cart', fields: [] }],
      events: [
        { id: 'ev1', name: 'cart.updated' },
        { id: 'ev2', name: 'never.emitted' }
      ],
      featureInvariants: [{ id: 'fi1' }]
    } as never;

    const keys = buildExpectedIndexKeys([feature]);

    // The forms the coverage reports consume.
    for (const key of [
      'surface:surf1',
      'action:act1',
      'state:cart.itemCount',
      'surface_rule:sr1',
      'surface_invariant:si1',
      'rule:ar1',
      'invariant:ai1',
      'transition:at1',
      'event:cart.updated'
    ]) {
      expect(keys.has(key), key).toBe(true);
    }

    // The documented forms that were previously flagged as orphans.
    for (const key of ['entity:en1', 'invariant:fi1', 'transition:st1', 'event:never.emitted']) {
      expect(keys.has(key), key).toBe(true);
    }

    expect(keys.has('action:ghost')).toBe(false);
  });
});
