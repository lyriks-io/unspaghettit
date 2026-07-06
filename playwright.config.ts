import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke tests for the dashboard: the parts that only exist at
 * runtime in a browser (client-side route gating, the header view switcher,
 * the load-samples journey, lazy-loaded graph rendering), which unit tests
 * and svelte-check can't cover.
 *
 * Two dev servers run in parallel so both enablement states are exercised
 * without restarting: one with the Builder view ON, one with it OFF. Playwright
 * sets `PUBLIC_UNSPA_VIEWS` in each server's env; Vite's dotenv won't override
 * an already-set process.env var, so these win over the local `.env.local`.
 *
 * Each server points UNSPA_SNAPSHOTS at its own throwaway hub under
 * e2e/.tmp/, reset by prepare-hub.cjs on startup. E2E runs therefore start
 * from a known-empty state and can never read or mutate the developer's
 * real shared hub.
 */
export const BUILDER_URL = 'http://localhost:4173';
export const EXPERT_URL = 'http://localhost:4174';

const BUILDER_HUB = resolve(process.cwd(), 'e2e/.tmp/hub-builder');
const EXPERT_HUB = resolve(process.cwd(), 'e2e/.tmp/hub-expert');

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { headless: true, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e/prepare-hub.cjs e2e/.tmp/hub-builder && npm run dev -- --port 4173 --strictPort',
      port: 4173,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { PUBLIC_UNSPA_VIEWS: 'builder', UNSPA_SNAPSHOTS: BUILDER_HUB }
    },
    {
      command: 'node e2e/prepare-hub.cjs e2e/.tmp/hub-expert && npm run dev -- --port 4174 --strictPort',
      port: 4174,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { PUBLIC_UNSPA_VIEWS: '', UNSPA_SNAPSHOTS: EXPERT_HUB }
    }
  ]
});
