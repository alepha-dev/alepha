import { expect, test } from "@playwright/test";

import { createProjectViaWizard, registerAndVerify } from "./_helpers.ts";

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
    const projectSlug = new URL(page.url()).pathname.split("/").find(Boolean);
    expect(projectSlug).toBeTruthy();

    // Kanban is a view of the Quests page now, not a
    // sidebar entry (the great rename, Task 8), so it can no longer prove
    // that a feature toggle updates the sidebar. Releases is still a
    // plain gated sidebar link (ProjectView.tsx), so it drives the same
    // regression check the test was written for.
    const sidebarReleases = page.locator(`a[href="/${projectSlug}/releases"]`);

    // Releases is ON by default → sidebar link is visible
    await expect(sidebarReleases).toBeVisible();

    // Navigate directly to the Releases settings sub-page
    await page.goto(`/${projectSlug}/settings/releases`);
    await page.waitForLoadState("networkidle");

    // Switch should be checked
    const releasesSwitch = page.getByRole("switch", { name: /enable/i });
    await expect(releasesSwitch).toHaveAttribute("aria-checked", "true");

    // Toggle OFF
    await releasesSwitch.click();
    await expect(releasesSwitch).toHaveAttribute("aria-checked", "false", {
      timeout: 5_000,
    });

    // Sidebar should drop the Releases link
    await expect(sidebarReleases).toHaveCount(0);

    // Reload, verify persistence: Switch still OFF and sidebar link still absent
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("switch", { name: /enable/i })).toHaveAttribute(
      "aria-checked",
      "false",
      { timeout: 5_000 },
    );
    await expect(sidebarReleases).toHaveCount(0);

    // Toggle back ON
    await page.getByRole("switch", { name: /enable/i }).click();
    await expect(page.getByRole("switch", { name: /enable/i })).toHaveAttribute(
      "aria-checked",
      "true",
      { timeout: 5_000 },
    );
    await expect(sidebarReleases).toBeVisible();
  });

  /**
   * Quality is the one module that ships OFF and has to be turned on by hand:
   * its data is pushed by a foreign CI job, so the flag is deliberately absent
   * from every project's defaults and the Reports tab hides until it is set.
   * This page is the only switch there is. Before it existed, the Alepha
   * project received a run a day and showed none of them.
   */
  test("Quality is off until its settings page turns it on, then Reports grows the tab", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const ts = Date.now();
    await registerAndVerify(page, `qual${ts}@example.com`, "GoodPassw0rd");
    const { slug } = await createProjectViaWizard(
      page,
      `Qual${ts}`.slice(0, 20),
    );

    const qualityTab = page.locator(`a[href="/${slug}/reports/quality"]`);

    await test.step("a new project has no Quality tab", async () => {
      await page.goto(`/${slug}/reports`);
      await page.waitForLoadState("networkidle");
      // A sibling tab proves Reports rendered at all: a missing Quality tab
      // on a blank page would prove nothing.
      await expect(
        page.locator(`a[href="/${slug}/reports/quests"]`),
      ).toBeVisible();
      await expect(qualityTab).toHaveCount(0);
    });

    await test.step("its settings page reads off, and turns it on", async () => {
      await page.goto(`/${slug}/settings/quality`);
      await page.waitForLoadState("networkidle");
      const qualitySwitch = page.getByRole("switch", { name: /enable/i });
      await expect(qualitySwitch).toHaveAttribute("aria-checked", "false");
      // Armed BEFORE the click and awaited before leaving the page. The
      // switch flips optimistically, so `aria-checked` proves nothing about
      // the save, and the client batches calls in a 10ms window: a navigation
      // right after the click cancels a request that has not been sent yet.
      // Same trap as the folio tree drag.
      const saved = page.waitForResponse((res) =>
        (res.request().postData() ?? "").includes('"quality"'),
      );
      await qualitySwitch.click();
      expect((await saved).ok()).toBe(true);
      await expect(qualitySwitch).toHaveAttribute("aria-checked", "true", {
        timeout: 5_000,
      });
    });

    await test.step("Reports offers the tab, and it opens on the nothing-pushed-yet panel", async () => {
      await page.goto(`/${slug}/reports`);
      await page.waitForLoadState("networkidle");
      await expect(qualityTab).toBeVisible();
      await qualityTab.click();
      await expect(page).toHaveURL(new RegExp(`/${slug}/reports/quality$`));
      // The panel prints the push command with THIS project's slug in it.
      await expect(page.locator("pre code")).toContainText(`--project ${slug}`);
    });
  });
});
