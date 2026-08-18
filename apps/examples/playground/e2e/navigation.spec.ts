import { expect, test } from "@playwright/test";

test.describe("Navigation & shell", () => {
  test("home renders the welcome card", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByText(/Welcome to the Alepha Playground/),
    ).toBeVisible();
  });

  test("public sidebar lists Playgrounds, Demo, Forms gallery", async ({
    page,
  }) => {
    await page.goto("/");
    const groupLabels = page.locator('[data-sidebar="group-label"]');
    await expect(groupLabels.filter({ hasText: "Playgrounds" })).toBeVisible();
    await expect(groupLabels.filter({ hasText: "Demo" })).toBeVisible();
    await expect(
      groupLabels.filter({ hasText: "Forms gallery" }),
    ).toBeVisible();
  });

  test("breadcrumbs follow active page", async ({ page }) => {
    await page.goto("/demo/auto-form");
    const crumbs = page.getByLabel("breadcrumb");
    await expect(crumbs).toContainText("Demo");
    await expect(crumbs).toContainText("AutoForm");
  });
});
