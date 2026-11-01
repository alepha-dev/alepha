import { expect, test } from "./_fixtures.ts";
import {
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * `$page({ loading })` on a real client navigation: a click on a quest whose
 * loaders are slow keeps the shell, shows the skeleton in the page's slot and
 * leaves the URL on the page that is going away.
 */
test.describe("Per-route loading UI", () => {
  test("a slow quest shows its skeleton inside the shell", async ({ page }) => {
    const stamp = Date.now();
    await registerAndVerify(
      page,
      `loading-${stamp}@example.com`,
      "GoodPassw0rd",
    );
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `Loading${stamp}`.slice(0, 24),
    );
    const { shortId } = await apiPost<{ shortId: number }>(
      page,
      "createQuest",
      {
        projectId,
        title: "A slow quest",
        description: "Seeded so the table has a row to open",
        area: "Main",
        priority: "low",
        objectives: [],
        attachments: [],
      },
    );

    await page.goto(`/${slug}/quests`);
    await expect(page.getByTestId("quests-table")).toBeVisible({
      timeout: 10_000,
    });

    // Held by hand: the skeleton must be seen, so the loaders finish when the
    // spec says.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/**", async (route) => {
      await held;
      await route.continue();
    });

    await page.evaluate((href) => {
      const anchor = document.createElement("a");
      anchor.href = href;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }, `/${slug}/quests/${shortId}`);

    await expect(page.getByTestId("project-page-skeleton")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-slot="sidebar"]').first()).toBeVisible();
    await expect(page.getByTestId("quests-table")).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(`/${slug}/quests`);

    release();

    await page.waitForURL(
      (url) => url.pathname === `/${slug}/quests/${shortId}`,
    );
    await expect(page.getByTestId("project-page-skeleton")).toHaveCount(0);
    await expect(page.getByText("A slow quest").first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
