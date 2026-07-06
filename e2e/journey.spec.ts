import { expect, test } from '@playwright/test';
import { EXPERT_URL } from '../playwright.config';

/**
 * Browser-level smoke coverage for the flows a unit test can't exercise:
 * the load-samples round trip, project navigation, the feature editor
 * page (the heaviest route in the client bundle), and the lazily loaded
 * vis-network behavior graph. Runs against the Expert server, whose hub
 * starts empty (see prepare-hub.cjs), so the journey owns its own data.
 *
 * The whole journey lives in ONE test on purpose: steps share state (the
 * loaded sample project), and fullyParallel would otherwise interleave a
 * mutation with the assertions that depend on it.
 */
test('load samples, open the eShop project, edit a feature, render its graph', async ({
  page
}) => {
  // Empty hub: the projects page empty state offers the samples entry point.
  await page.goto(`${EXPERT_URL}/projects`);

  // First visit in a fresh browser context: the display-name onboarding
  // dialog opens over the page and swallows clicks until it is answered.
  // Saving with the field empty means "stay anonymous" and closes it.
  const nameDialog = page.getByRole('dialog', { name: 'Your display name' });
  await expect(nameDialog).toBeVisible();
  await nameDialog.getByRole('button', { name: 'Save' }).click();
  await expect(nameDialog).toBeHidden();

  await page.getByRole('button', { name: 'Explore the sample project' }).click();

  // The in-app dialog confirms what was added and offers to open the project.
  await expect(page.getByText('Samples loaded')).toBeVisible();
  await page.getByRole('button', { name: 'Open eShop' }).click();
  await expect(page).toHaveURL(/\/projects\//);

  // The project page lists the bundled features; open the checkout slice.
  const featureLink = page.getByRole('link', { name: /Cart & checkout/ });
  await expect(featureLink.first()).toBeVisible();
  await featureLink.first().click();
  await expect(page).toHaveURL(/\/features\//);

  // Feature editor route: the heaviest client chunk actually mounts.
  await expect(page.getByText('Cart & checkout').first()).toBeVisible();

  // Graph view: vis-network is dynamically imported in the browser; the
  // canvas region only appears when that import resolved and rendered.
  const featureUrl = new URL(page.url());
  await page.goto(`${featureUrl.origin}${featureUrl.pathname}/graph`);
  await expect(page.getByLabel(/Interactive behavior graph for/)).toBeVisible();
});

test('tutorial page renders its guided sections', async ({ page }) => {
  await page.goto(`${EXPERT_URL}/tutorial`);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load sample project' }).first()).toBeVisible();
});

test('projects API answers with JSON', async ({ request }) => {
  const res = await request.get(`${EXPERT_URL}/api/projects`);
  expect(res.status()).toBe(200);
  // Shape: { directory, summaries } (see src/routes/api/projects/+server.ts).
  const body = await res.json();
  expect(typeof body.directory).toBe('string');
  expect(Array.isArray(body.summaries)).toBe(true);
});

test('unknown feature id shows a graceful state, not a crash', async ({ page }) => {
  await page.goto(`${EXPERT_URL}/features/does-not-exist`);
  // Whatever the page shows (not-found copy or an empty editor shell), the
  // app shell must survive: no blank page, no unhandled error overlay.
  await expect(page.locator('body')).not.toContainText('Internal Error');
  await expect(page.locator('header, nav, main').first()).toBeVisible();
});
