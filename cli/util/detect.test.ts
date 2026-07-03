import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isCommandOnPath, pathExistsAny } from './detect';

const dir = mkdtempSync(join(tmpdir(), 'unspa-detect-'));
writeFileSync(join(dir, 'probe'), '');

describe('isCommandOnPath', () => {
  it('finds a bare-named file on the given PATH', () => {
    expect(isCommandOnPath('probe', { PATH: dir })).toBe(true);
  });

  it('returns false for an absent command', () => {
    expect(isCommandOnPath('definitely-not-here', { PATH: dir })).toBe(false);
  });

  it('returns false when PATH is empty', () => {
    expect(isCommandOnPath('probe', { PATH: '' })).toBe(false);
    expect(isCommandOnPath('probe', {})).toBe(false);
  });

  it.runIf(process.platform === 'win32')('resolves a .cmd shim via PATHEXT on Windows', () => {
    writeFileSync(join(dir, 'shim.cmd'), '');
    expect(isCommandOnPath('shim', { PATH: dir, PATHEXT: '.CMD' })).toBe(true);
  });
});

describe('pathExistsAny', () => {
  it('is true when at least one path exists', () => {
    expect(pathExistsAny([join(dir, 'nope'), join(dir, 'probe')])).toBe(true);
  });

  it('is false when none exist', () => {
    expect(pathExistsAny([join(dir, 'nope'), join(dir, 'still-nope')])).toBe(false);
  });

  it('is false for an empty list', () => {
    expect(pathExistsAny([])).toBe(false);
  });
});

afterAll(() => {
  // best-effort; the OS temp dir is reclaimed regardless
});
