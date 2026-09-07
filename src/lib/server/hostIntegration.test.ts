import { afterEach, expect, it, vi } from 'vitest';
import { hostOwnsStateDeletion } from './hostIntegration';

afterEach(() => vi.unstubAllEnvs());

it.each([undefined, '', '   '])('keeps standalone local without a host URL (%s)', (url) => {
  vi.stubEnv('UNSPA_HOST_URL', url);
  vi.stubEnv('PUBLIC_UNSPA_HOST_PRODUCT', 'Lyriks');
  expect(hostOwnsStateDeletion()).toBe(false);
});

it('activates host protection only through explicit server configuration', () => {
  vi.stubEnv('UNSPA_HOST_URL', 'http://127.0.0.1:5173');
  vi.stubEnv('PUBLIC_UNSPA_HOST_PRODUCT', undefined);
  expect(hostOwnsStateDeletion()).toBe(true);
});
