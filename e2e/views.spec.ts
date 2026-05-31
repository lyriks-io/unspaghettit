import { expect, test } from '@playwright/test';
import { BUILDER_URL, EXPERT_URL } from '../playwright.config';

test.describe('Builder enabled (PUBLIC_UNSPA_VIEWS=builder)', () => {
  test('header shows the Expert | Builder switcher', async ({ page }) => {
    await page.goto(`${BUILDER_URL}/projects`);
    const switcher = page.getByRole('group', { name: 'View mode' });
    await expect(switcher).toBeVisible();
    await expect(switcher.getByRole('link', { name: 'Builder' })).toBeVisible();
    await expect(switcher.getByRole('link', { name: 'Expert' })).toBeVisible();
  });

  test('/builder-mode renders (no redirect)', async ({ page }) => {
    await page.goto(`${BUILDER_URL}/builder-mode`);
    await expect(page).toHaveURL(/\/builder-mode/);
    await expect(page.getByRole('heading', { name: 'Your projects' })).toBeVisible();
  });
});

test.describe('Builder disabled (Expert only — the default)', () => {
  test('header shows no view switcher', async ({ page }) => {
    await page.goto(`${EXPERT_URL}/projects`);
    // Let the page settle, then assert the switcher never renders.
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.getByRole('group', { name: 'View mode' })).toHaveCount(0);
  });

  test('/builder-mode redirects to Expert', async ({ page }) => {
    await page.goto(`${EXPERT_URL}/builder-mode`);
    await expect(page).toHaveURL(/\/projects/);
    await expect(page).not.toHaveURL(/\/builder-mode/);
  });
});
