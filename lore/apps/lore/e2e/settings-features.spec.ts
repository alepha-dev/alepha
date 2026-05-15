import * as fs from "node:fs";
import { expect, test } from "@playwright/test";
import { clearEmails, emailDir, registerAndVerify } from "./_helpers.ts";

test.describe("Campaign settings — feature toggles", () => {
  test.beforeAll(() => {
    fs.mkdirSync(emailDir, { recursive: true });
    clearEmails();
  });

  test("toggle a feature ON, sidebar updates, persists on reload", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.log("BROWSER ERROR:", msg.text());
      }
    });
    page.on("response", async (res) => {
      if (res.url().includes("/api/") && !res.ok()) {
        const body = await res.text().catch(() => "<body unreadable>");
        console.log(
          `API ${res.status()} ${res.request().method()} ${res.url()}: ${body}`,
        );
      }
    });
    const ts = Date.now();
    const email = `feat${ts}@example.com`;
    const password = "GoodPassw0rd";
    const campaignTitle = `Camp${ts}`.slice(0, 20);

    await registerAndVerify(page, email, password);

    // Create campaign (3-step wizard: name → logo (skip) → modules → submit)
    await page.goto("/new-campaign");
    await page.waitForLoadState("networkidle");
    await page.locator('input[type="text"]').first().fill(campaignTitle);
    await page.getByRole("button", { name: /^next$/i }).click();
    // Step 2 (logo) — skip via Next
    await page.getByRole("button", { name: /^next$/i }).click();
    // Step 3 (modules) — submit with defaults
    await page.getByRole("button", { name: /create campaign/i }).click();
    await page.waitForURL(/\/c\/\d+/, { timeout: 15_000 });
    const match = page.url().match(/\/c\/(\d+)/);
    expect(match).not.toBeNull();
    const campaignId = match![1];

    // Sidebar link points to the kanban board (/c/:id/kanban), separate
    // from the settings sub-nav link (/c/:id/settings/kanban).
    const sidebarKanban = page.locator(`a[href="/c/${campaignId}/kanban"]`);

    // Kanban is ON by default → sidebar link is visible
    await expect(sidebarKanban).toBeVisible();

    // Navigate directly to the Kanban settings sub-page
    await page.goto(`/c/${campaignId}/settings/kanban`);
    await page.waitForLoadState("networkidle");

    // Switch should be checked
    const kanbanSwitch = page.getByRole("switch", { name: /enable/i });
    await expect(kanbanSwitch).toHaveAttribute("data-state", "checked");

    // Toggle OFF
    await kanbanSwitch.click();
    await expect(kanbanSwitch).toHaveAttribute("data-state", "unchecked", {
      timeout: 5_000,
    });

    // Sidebar should drop the board Kanban link
    await expect(sidebarKanban).toHaveCount(0);

    // Reload, verify persistence: Switch still OFF and sidebar link still absent
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("switch", { name: /enable/i })).toHaveAttribute(
      "data-state",
      "unchecked",
      { timeout: 5_000 },
    );
    await expect(sidebarKanban).toHaveCount(0);

    // Toggle back ON
    await page.getByRole("switch", { name: /enable/i }).click();
    await expect(page.getByRole("switch", { name: /enable/i })).toHaveAttribute(
      "data-state",
      "checked",
      { timeout: 5_000 },
    );
    await expect(sidebarKanban).toBeVisible();
  });
});
