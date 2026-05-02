import { expect, test } from "@playwright/test";

test.use({ storageState: "./e2e/.admin-state.json" });

test.describe("Admin pages mount (logged-in admin)", () => {
  for (const { path, label } of [
    { path: "/admin/users", label: "Users" },
    { path: "/admin/sessions", label: "Sessions" },
    { path: "/admin/keys", label: "API keys" },
    { path: "/admin/jobs", label: "Jobs" },
    { path: "/admin/notifications", label: "Notifications" },
    { path: "/admin/audits", label: "Audit log" },
    { path: "/admin/files", label: "Files" },
    { path: "/admin/parameters", label: "Parameters" },
  ] as const) {
    test(`${label} → ${path}`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBeLessThan(400);
      await expect(page.getByText(/STACK TRACE/i)).toHaveCount(0);
    });
  }
});

test.describe("Admin Files: upload + list + delete", () => {
  test("upload, list refresh, delete confirmation", async ({ page }) => {
    await page.goto("/admin/files");
    await expect(page.getByRole("button", { name: /^Upload$/ })).toBeVisible();

    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles("./e2e/fixtures/sample.txt");

    const firstRow = page.locator("tbody tr").first();
    await expect(firstRow).toContainText("sample.txt", { timeout: 15_000 });

    await firstRow.locator("button[aria-haspopup]").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(
      page.getByText('Permanently delete "sample.txt"?'),
    ).toBeVisible();

    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText('Permanently delete "sample.txt"?')).toBeHidden(
      { timeout: 5_000 },
    );
  });
});

test.describe("Admin gate (anonymous)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("anonymous /admin returns 401", async ({ request }) => {
    const res = await request.get("/admin", {
      maxRedirects: 0,
      failOnStatusCode: false,
    });
    expect([401, 302]).toContain(res.status());
  });
});
