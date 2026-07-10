import { describe, expect, it } from 'vitest';
import { isNewerVersion } from './compareVersions';

describe('isNewerVersion', () => {
  it('detects a newer minor / patch / major', () => {
    expect(isNewerVersion('0.9.0', '0.8.0')).toBe(true);
    expect(isNewerVersion('0.8.1', '0.8.0')).toBe(true);
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true);
  });

  it('is false for equal or older versions', () => {
    expect(isNewerVersion('0.8.0', '0.8.0')).toBe(false);
    expect(isNewerVersion('0.8.0', '0.9.0')).toBe(false);
    expect(isNewerVersion('0.8.0', '0.8.1')).toBe(false);
  });

  it('ignores a leading v and any prerelease / build suffix', () => {
    expect(isNewerVersion('v0.9.0', '0.8.0')).toBe(true);
    expect(isNewerVersion('0.9.0-rc.1', '0.8.0')).toBe(true);
    // Equal cores: a stable release is not "newer" than the same prerelease.
    expect(isNewerVersion('0.8.0', '0.8.0-rc.1')).toBe(false);
  });

  it('returns false for unparseable input rather than a spurious notice', () => {
    expect(isNewerVersion('abc', '0.8.0')).toBe(false);
    expect(isNewerVersion('0.9.0', 'not-a-version')).toBe(false);
    expect(isNewerVersion('', '0.8.0')).toBe(false);
  });
});
