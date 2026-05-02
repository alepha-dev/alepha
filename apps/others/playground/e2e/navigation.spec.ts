import { expect, test } from "@playwright/test";

test.describe("Navigation & shell", () => {
  test("home redirects to /resources/jobs", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/resources\/jobs$/);
  });

  test("sidebar lists Resources, Playgrounds, Demo", async ({ page }) => {
    await page.goto("/resources/jobs");
    const groupLabels = page.locator('[data-sidebar="group-label"]');
    await expect(groupLabels.filter({ hasText: "Resources" })).toBeVisible();
    await expect(groupLabels.filter({ hasText: "Playgrounds" })).toBeVisible();
    await expect(groupLabels.filter({ hasText: "Demo" })).toBeVisible();
  });

  test("breadcrumbs follow active page", async ({ page }) => {
    await page.goto("/demo/auto-form");
    const crumbs = page.getByLabel("breadcrumb");
    await expect(crumbs).toContainText("Demo");
    await expect(crumbs).toContainText("AutoForm");
  });
});
