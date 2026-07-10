import { describe, expect, it } from 'vitest';
import {
  formatUpdateNotice,
  isUpdateCheckDisabled,
  PACKAGE_NAME,
  updateCacheFilePath
} from './updateCheck';

describe('isUpdateCheckDisabled', () => {
  it('is off by default (empty env)', () => {
    expect(isUpdateCheckDisabled({})).toBe(false);
  });

  it('honors the project opt-out, the community var, and CI', () => {
    expect(isUpdateCheckDisabled({ UNSPA_NO_UPDATE_CHECK: '1' })).toBe(true);
    expect(isUpdateCheckDisabled({ NO_UPDATE_NOTIFIER: 'true' })).toBe(true);
    expect(isUpdateCheckDisabled({ CI: 'true' })).toBe(true);
  });

  it('treats falsy string values as not-disabled', () => {
    expect(isUpdateCheckDisabled({ UNSPA_NO_UPDATE_CHECK: '' })).toBe(false);
    expect(isUpdateCheckDisabled({ UNSPA_NO_UPDATE_CHECK: '0' })).toBe(false);
    expect(isUpdateCheckDisabled({ CI: 'false' })).toBe(false);
  });
});

describe('formatUpdateNotice', () => {
  it('returns a one-line notice when an update is available', () => {
    const notice = formatUpdateNotice({ current: '0.8.0', latest: '0.9.0', updateAvailable: true });
    expect(notice).toContain('0.8.0 → 0.9.0');
    expect(notice).toContain(`npm i -g ${PACKAGE_NAME}@latest`);
  });

  it('is null when up to date or status is unknown', () => {
    expect(
      formatUpdateNotice({ current: '0.8.0', latest: '0.8.0', updateAvailable: false })
    ).toBeNull();
    expect(formatUpdateNotice({ current: '0.8.0', latest: null, updateAvailable: false })).toBeNull();
  });
});

describe('updateCacheFilePath', () => {
  it('places the cache under the shared-hub root', () => {
    const path = updateCacheFilePath('/home/dev');
    expect(path.replace(/\\/g, '/')).toBe('/home/dev/.unspa-hub/.update-check.json');
  });
});
