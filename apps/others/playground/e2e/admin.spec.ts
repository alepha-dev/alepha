import { expect, test } from "@playwright/test";

test.describe("Admin resources", () => {
  for (const { path, label } of [
    { path: "/resources/jobs", label: "Jobs" },
    { path: "/resources/notifications", label: "Notifications" },
    { path: "/resources/audits", label: "Audit log" },
    { path: "/resources/files", label: "Files" },
    { path: "/resources/parameters", label: "Parameters" },
  ] as const) {
    test(`${label} page mounts`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("h1, h2").first()).toBeVisible();
    });
  }
});

test.describe("Admin Files: upload + list + delete", () => {
  test("upload, list refresh, delete confirmation", async ({ page }) => {
    await page.goto("/resources/files");
    await expect(page.getByRole("button", { name: /^Upload$/ })).toBeVisible();

    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: /^Upload$/ }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles("./e2e/fixtures/sample.txt");

    // first row should be our newest upload
    const firstRow = page.locator("tbody tr").first();
    await expect(firstRow).toContainText("sample.txt", { timeout: 15_000 });

    // open the row's actions menu
    await firstRow.locator("button[aria-haspopup]").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

    // confirm dialog mentions the file name
    await expect(
      page.getByText('Permanently delete "sample.txt"?'),
    ).toBeVisible();

    await page.getByRole("button", { name: "Confirm" }).click();
    // the dialog closes
    await expect(page.getByText('Permanently delete "sample.txt"?')).toBeHidden(
      { timeout: 5_000 },
    );
  });
});
