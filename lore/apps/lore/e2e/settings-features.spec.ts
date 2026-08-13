import { expect, test } from "@playwright/test";
import { registerAndVerify } from "./_helpers.ts";

test.describe("Project settings — feature toggles", () => {
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
    const projectTitle = `Camp${ts}`.slice(0, 20);

    await registerAndVerify(page, email, password);

    // Create project (3-step wizard: name → logo (skip) → modules → submit)
    await page.goto("/new-project");
    await page.waitForLoadState("networkidle");
    await page.locator('input[type="text"]').first().fill(projectTitle);
    await page.getByRole("button", { name: /^next$/i }).click();
    // Step 2 (logo) — skip via Next
    await page.getByRole("button", { name: /^next$/i }).click();
    // Step 3 (modules) — submit with defaults
    await page.getByRole("button", { name: /create project/i }).click();
    await page.waitForURL(
      (url) =>
        url.pathname !== "/new-project" &&
        url.pathname.split("/").filter(Boolean).length === 1,
      { timeout: 15_000 },
    );
    // The wizard lands on `/<slug>` — the project's URL identity is the whole
    // first segment now, not an id behind a `/p/` prefix.
    const projectSlug = new URL(page.url()).pathname
      .split("/")
      .filter(Boolean)[0];
    expect(projectSlug).toBeTruthy();

    // Kanban is a view of the Quests page now, not a
    // sidebar entry (the great rename, Task 8), so it can no longer prove
    // that a feature toggle updates the sidebar. Milestones is still a
    // plain gated sidebar link (ProjectView.tsx), so it drives the same
    // regression check the test was written for.
    const sidebarMilestones = page.locator(
      `a[href="/${projectSlug}/milestones"]`,
    );

    // Milestones is ON by default → sidebar link is visible
    await expect(sidebarMilestones).toBeVisible();

    // Navigate directly to the Milestones settings sub-page
    await page.goto(`/${projectSlug}/settings/milestones`);
    await page.waitForLoadState("networkidle");

    // Switch should be checked
    const milestonesSwitch = page.getByRole("switch", { name: /enable/i });
    await expect(milestonesSwitch).toHaveAttribute("aria-checked", "true");

    // Toggle OFF
    await milestonesSwitch.click();
    await expect(milestonesSwitch).toHaveAttribute("aria-checked", "false", {
      timeout: 5_000,
    });

    // Sidebar should drop the Milestones link
    await expect(sidebarMilestones).toHaveCount(0);

    // Reload, verify persistence: Switch still OFF and sidebar link still absent
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("switch", { name: /enable/i })).toHaveAttribute(
      "aria-checked",
      "false",
      { timeout: 5_000 },
    );
    await expect(sidebarMilestones).toHaveCount(0);

    // Toggle back ON
    await page.getByRole("switch", { name: /enable/i }).click();
    await expect(page.getByRole("switch", { name: /enable/i })).toHaveAttribute(
      "aria-checked",
      "true",
      { timeout: 5_000 },
    );
    await expect(sidebarMilestones).toBeVisible();
  });
});
