import { expect, test } from "@playwright/test";

test.describe("Toasts demo", () => {
  test("success toast renders with message", async ({ page }) => {
    await page.goto("/demo/toasts");
    await page.getByRole("button", { name: /^success$/i }).click();
    await expect(page.locator("[data-sonner-toast]").first()).toBeVisible();
  });

  test("info toast renders", async ({ page }) => {
    await page.goto("/demo/toasts");
    await page.getByRole("button", { name: /^info$/i }).click();
    await expect(
      page.locator('[data-sonner-toast][data-type="info"]').first(),
    ).toBeVisible();
  });
});

test.describe("Dialogs demo", () => {
  test("dialogs page mounts", async ({ page }) => {
    await page.goto("/demo/dialogs");
    await expect(page.getByRole("button").first()).toBeVisible();
  });
});

test.describe("Playgrounds (jobs/notifications/audits)", () => {
  for (const path of [
    "/playgrounds/jobs",
    "/playgrounds/notifications",
    "/playgrounds/audits",
  ]) {
    test(`${path} mounts`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("body")).toBeVisible();
      // no error boundary on screen
      await expect(page.getByText(/STACK TRACE/i)).toHaveCount(0);
    });
  }
});
