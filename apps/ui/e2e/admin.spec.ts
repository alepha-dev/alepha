import { expect, test } from "@playwright/test";

/**
 * The unit specs prove the fixtures satisfy their response schemas. They cannot
 * prove the components RENDER, and that is the gap this suite closes: every
 * failure mode found while building these pages was invisible to a green unit
 * run.
 *
 *   - a controller left out of the module answered "Action not found" and drew
 *     an empty table;
 *   - a page left out of the layout's `children` still resolved and still
 *     returned 200, but rendered outside DialogProvider, so any component
 *     calling useDialog threw on sight.
 *
 * So each spec asserts CONTENT from the fixtures, never a status code, and the
 * shell assertion is what catches the second failure: `Admin` in the sidebar
 * only exists when the page is inside the layout.
 */
const PAGES = [
  { path: "dashboard", heading: "Admin: dashboard", content: "Users" },
  { path: "users", heading: "Admin: users", content: "ada@alepha.dev" },
  { path: "sessions", heading: "Admin: sessions", content: "ada@alepha.dev" },
  { path: "keys", heading: "Admin: API keys", content: "CI pipeline" },
  { path: "jobs", heading: "Admin: jobs", content: "ShowcaseJobs.sendDigest" },
  { path: "files", heading: "Admin: files", content: "quarterly-report.pdf" },
  {
    path: "notifications",
    heading: "Admin: notifications",
    content: "ada@alepha.dev",
  },
  { path: "parameters", heading: "Admin: parameters", content: "Limits" },
  { path: "analytics", heading: "Admin: analytics", content: "pageviews" },
  { path: "payments", heading: "Admin: payments", content: "pi_showcase" },
  { path: "audits", heading: "Admin: audit log", content: "user:login" },
] as const;

test.describe("admin blocks", () => {
  for (const page of PAGES) {
    test(`${page.path} renders inside the shell, with fixture data`, async ({
      page: browser,
    }) => {
      await browser.goto(`/blocks/admin/${page.path}`);

      await expect(
        browser.getByRole("heading", { name: page.heading }),
      ).toBeVisible();

      // Proves the page is a child of the layout. A page declared but missing
      // from `children` renders on its own, without the sidebar and without
      // the providers the layout mounts.
      await expect(
        browser.locator('[data-sidebar="group-label"]').filter({
          hasText: "Admin",
        }),
      ).toBeVisible();

      await expect(browser.getByText(page.content).first()).toBeVisible();
    });
  }

  test("a job's executions load with retry and cancel affordances", async ({
    page,
  }) => {
    await page.goto("/blocks/admin/jobs");
    await page.getByText("ShowcaseJobs.sendDigest").click();

    // `can.retry` / `can.cancel` decide these, so a fixture without a failed
    // and a running row would never show them.
    await expect(page.getByText("Failed").first()).toBeVisible();
    await expect(page.getByText("Running").first()).toBeVisible();
  });

  test("a parameter opens its version history", async ({ page }) => {
    await page.goto("/blocks/admin/parameters");
    await page.getByText("Limits", { exact: true }).click();

    // One version per status the panel draws differently.
    await expect(page.getByText("Current").first()).toBeVisible();
    await expect(page.getByText("Expired").first()).toBeVisible();
  });
});
