import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import {
  apiPath,
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * `prefetch` on Lore's three hover surfaces and its one visible one. What is
 * asserted is the network: the page's chunk is requested before the click, and
 * the click then requests no code at all.
 */
const scripts = (page: Page) => {
  const seen: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") {
      seen.push(request.url());
    }
  });
  return seen;
};

const setup = async (page: Page, name: string) => {
  const stamp = Date.now();
  await registerAndVerify(page, `${name}-${stamp}@example.com`, "GoodPassw0rd");
  const { id: projectId, slug } = await createProjectViaWizard(
    page,
    `${name}${stamp}`.slice(0, 24),
    { options: { work: ["board"] } },
  );
  const { shortId } = await apiPost<{ shortId: number }>(page, "createQuest", {
    projectId,
    title: "A quest to hover",
    description: "Seeded so the table has a row",
    area: "Main",
    priority: "low",
    objectives: [],
    attachments: [],
  });
  return { projectId, slug, shortId };
};

test.describe("Link prefetching", () => {
  test("the sidebar fetches a page's code on hover", async ({ page }) => {
    const { slug } = await setup(page, "PrefetchNav");

    await page.goto(`/${slug}/activity`);
    await page.waitForLoadState("networkidle");

    const link = page.locator(`a[href="/${slug}/quests"]`).first();
    await expect(link).toHaveAttribute("data-prefetch", "hover");

    const seen = scripts(page);
    await link.hover();
    await expect.poll(() => seen.length).toBeGreaterThan(0);
    await page.waitForLoadState("networkidle");

    // What the hover fetched is not fetched again. The page may still load
    // chunks of its own once it renders: those are not its `lazy`.
    await link.click();
    await page.waitForURL((url) => url.pathname === `/${slug}/quests`);
    await page.waitForLoadState("networkidle");
    expect(new Set(seen).size).toBe(seen.length);
  });

  test("a Reports tab starts its query on hover, and the click paints with no request", async ({
    page,
  }) => {
    const { slug } = await setup(page, "PrefetchTab");

    await page.goto(`/${slug}/reports`);
    await expect(page.getByTestId("reports-tabs")).toBeVisible({
      timeout: 10_000,
    });
    await page.waitForLoadState("networkidle");

    const flow = await apiPath(page, "getReportsFlow");
    const reads: string[] = [];
    page.on("request", (request) => {
      const line = `${request.url()} ${request.postData()}`;
      if (line.includes(flow.split(":")[0])) {
        reads.push(line);
      }
    });

    const tab = page
      .getByTestId("reports-tabs")
      .locator(`a[href^="/${slug}/reports/flow"]`);
    await tab.hover();
    await expect.poll(() => reads.length).toBeGreaterThan(0);
    await page.waitForLoadState("networkidle");

    const before = reads.length;
    await tab.click();
    await page.waitForURL((url) => url.pathname === `/${slug}/reports/flow`);
    await expect(tab).toHaveAttribute("aria-current", "page");
    await page.waitForLoadState("networkidle");

    expect(reads.length).toBe(before);
  });

  test("a quest row fetches the quest page's code on hover", async ({
    page,
  }) => {
    const { slug, shortId } = await setup(page, "PrefetchRow");

    await page.goto(`/${slug}/quests`);
    await expect(page.getByTestId("quests-table")).toBeVisible({
      timeout: 10_000,
    });
    await page.waitForLoadState("networkidle");

    const seen = scripts(page);
    const row = page.getByTestId("quests-table").getByText("A quest to hover");
    await row.hover();
    await expect.poll(() => seen.length).toBeGreaterThan(0);
    await page.waitForLoadState("networkidle");

    const before = seen.length;
    await row.click();
    await page.waitForURL(
      (url) => url.pathname === `/${slug}/quests/${shortId}`,
    );
    await page.waitForLoadState("networkidle");
    expect(seen.length).toBe(before);
  });

  test("Home's recent projects fetch their code when visible", async ({
    page,
  }) => {
    const { slug } = await setup(page, "PrefetchHome");

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const link = page
      .getByTestId("home-project-row")
      .locator('a[data-prefetch="visible"]');
    await expect(link).toHaveCount(1);

    // No more code from here on: the click can only work on what the row
    // already fetched. A chunk it had to load would fail, and show the error.
    await page.route("**/*.js", (route) => route.abort());
    await link.click();
    await page.waitForURL((url) => url.pathname.startsWith(`/${slug}`));
    await page.waitForLoadState("networkidle");

    await expect(page.locator('[data-slot="sidebar"]').first()).toBeVisible();
  });

  test("a failed chunk under a hover does not reload the page", async ({
    page,
  }) => {
    const { slug } = await setup(page, "PrefetchFail");

    await page.goto(`/${slug}/activity`);
    await page.waitForLoadState("networkidle");

    await page.evaluate(() => {
      (window as unknown as { __mark: boolean }).__mark = true;
    });
    await page.route("**/*.js", (route) => route.abort());
    await page.locator(`a[href="/${slug}/kanban"]`).first().hover();
    await page.waitForTimeout(500);

    expect(
      await page.evaluate(
        () => (window as unknown as { __mark?: boolean }).__mark,
      ),
    ).toBe(true);
  });

  test("saveData fetches nothing on a hover", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "connection", {
        value: { saveData: true },
      });
    });
    const { slug } = await setup(page, "PrefetchSave");

    await page.goto(`/${slug}/activity`);
    await page.waitForLoadState("networkidle");

    const seen = scripts(page);
    await page.locator(`a[href="/${slug}/kanban"]`).first().hover();
    await page.waitForTimeout(500);

    expect(seen).toEqual([]);
  });
});
