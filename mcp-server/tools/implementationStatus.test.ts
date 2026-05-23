import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { healIndexLines } from './implementationStatus';
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
