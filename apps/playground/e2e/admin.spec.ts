import { expect, test } from "@playwright/test";
import { readLatestEmailCode } from "./global-setup.ts";

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

test.describe("Admin Users: enable / disable toggle", () => {
  test("disabling a user blocks login; re-enabling restores it", async ({
    page,
    request,
  }) => {
    // Create a fresh, verified user via the API.
    const email = `toggle-${Date.now()}@example.com`;
    const password = "togglepw123";
    const intent = await request.post("/api/users/register", {
      data: { email, password },
    });
    expect(intent.status()).toBe(200);
    const { intentId, expectEmailVerification } = await intent.json();
    const code = expectEmailVerification
      ? await readLatestEmailCode(email)
      : undefined;
    const complete = await request.post("/api/users/register/complete", {
      data: { intentId, emailCode: code },
    });
    expect(complete.status()).toBe(200);

    // Sanity: the new user can log in.
    const initialLogin = await request.post(
      "/_auth/token?provider=credentials",
      { data: { username: email, password } },
    );
    expect(initialLogin.status()).toBe(200);

    // Visit /admin/users and find the row by email.
    await page.goto("/admin/users");
    const row = page.locator("tbody tr").filter({ hasText: email }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Open the row actions menu and disable.
    await row.locator("button[aria-haspopup]").click();
    await page.getByRole("menuitem", { name: /Disable user/ }).click();
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(row).toContainText(/Disabled/i, { timeout: 10_000 });

    // Disabled user can no longer authenticate.
    const blockedLogin = await request.post(
      "/_auth/token?provider=credentials",
      { data: { username: email, password } },
    );
    expect(blockedLogin.status()).not.toBe(200);

    // Re-enable via the same row.
    await row.locator("button[aria-haspopup]").click();
    await page.getByRole("menuitem", { name: /Enable user/ }).click();
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(row).toContainText(/Active/i, { timeout: 10_000 });

    // Login works again.
    const restoredLogin = await request.post(
      "/_auth/token?provider=credentials",
      { data: { username: email, password } },
    );
    expect(restoredLogin.status()).toBe(200);
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
