import { expect, test } from "@playwright/test";

import { registerAndVerify } from "./_helpers.ts";

/**
 * Admin analytics page (`/admin/analytics`).
 *
 * Smoke: the page is reachable by an admin, lists the two code-declared
 * sigil datasets, and a query round-trips (an empty result on a fresh
 * database renders the empty state, not an error).
 *
 * The admin account is auto-promoted on first login because
 * `playwright.config.ts` sets `ADMIN_EMAIL=admin@example.com` for the
 * webServer — same pattern as `admin-user-detail.spec.ts`.
 */
test.describe("admin analytics", () => {
  const adminEmail = "admin@example.com";
  const adminPassword = "GoodPassw0rd";

  test("lists datasets and runs an empty query", async ({ page }) => {
    await registerAndVerify(page, adminEmail, adminPassword);
    // Force a fresh sign-in so the role-promotion path fires (registration
    // already logged them in once, but the slug-derived role refresh happens
    // on every login, not on register).
    await page.goto("/auth/logout");
    await page.waitForLoadState("domcontentloaded");

    await page.goto("/auth/login");
    await page
      .getByRole("textbox", { name: /identifier|email/i })
      .first()
      .fill(adminEmail);
    await page
      .getByRole("textbox", { name: /password/i })
      .first()
      .fill(adminPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/^http:\/\/[^/]+\/$/, { timeout: 15_000 });

    await page.goto("/admin/analytics");
    await page.waitForLoadState("domcontentloaded");

    // The dataset picker defaults to the first declared dataset.
    await expect(page.getByText("sigil_views").first()).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: /run query/i }).click();
    await expect(page.getByText(/no data for this query/i)).toBeVisible({
      timeout: 15_000,
    });
  });
});
