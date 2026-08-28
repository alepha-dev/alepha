import { expect, test } from "@playwright/test";

/**
 * The Ops page drives the generic job endpoints, which had no page at all -
 * which is how `/playground/jobs/:name/sample` went on answering `{}` for
 * months. It walked a TypeBox schema, and the schemas became zod.
 */
test.describe("Ops playground", () => {
  test("fills the payload from the job's own schema, and runs it", async ({
    page,
  }) => {
    await page.goto("/playgrounds/ops");

    await page.getByTestId("ops-job-PlaygroundJobs.sendMail").click();

    // The sample is generated server-side from `z.object({ to, subject })`.
    // An empty object here is the bug this page exists to keep visible.
    const payload = page.getByTestId("ops-payload");
    await expect(payload).toHaveValue(/"to":/);
    await expect(payload).toHaveValue(/"subject":/);

    await page.getByTestId("ops-run").click();

    // The job records its execution, which the list polls for.
    await expect(page.getByTestId("ops-executions")).toContainText("ok", {
      timeout: 15_000,
    });
  });

  test("populates a nested object schema, not just the top level", async ({
    page,
  }) => {
    await page.goto("/playgrounds/ops");

    // This job's payload carries a `variables` record inside it, so it is the
    // one that proves the walker recurses.
    await page
      .getByTestId("ops-job-api:notifications:sendNotification")
      .click();

    await expect(page.getByTestId("ops-payload")).toHaveValue(/"variables":/);
  });

  test("reaches the page from the sidebar", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: "Ops", exact: true }).click();

    await expect(page).toHaveURL(/\/playgrounds\/ops$/);
    await expect(
      page.getByRole("heading", { name: "Ops", exact: true }),
    ).toBeVisible();
  });
});
