import { expect, test } from "./_fixtures.ts";
import { createProjectViaWizard, registerAndVerify } from "./_helpers.ts";

/**
 * The four capability pages, from the only side that matters: a switch here
 * has to change what the sidebar offers, and survive a reload.
 *
 * ⚠️ **Every switch on these pages is optimistic.** `aria-checked` flips the
 * instant the click fires and proves nothing about what was stored, and the
 * client batches calls in a ~10ms window, so navigating right after a click
 * cancels a request that has not been sent. Both cases below therefore arm
 * `waitForResponse` BEFORE the click, or reload and look again.
 *
 * The Quality case that used to live here is gone with the switch it drove:
 * Quality joined the Apps baseline, and its Reports tab self-hides until a run
 * exists rather than waiting on a flag.
 */
test.describe("Project settings — capabilities", () => {
  test("an option toggled off leaves the sidebar, and stays off across a reload", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const ts = Date.now();
    await registerAndVerify(page, `feat${ts}@example.com`, "GoodPassw0rd");
    const { slug } = await createProjectViaWizard(
      page,
      `Camp${ts}`.slice(0, 20),
      { options: { work: ["releases"] } },
    );

    const sidebarReleases = page.locator(`a[href="/${slug}/releases"]`);
    await expect(sidebarReleases).toBeVisible();

    await page.goto(`/${slug}/settings/work`);
    await page.waitForLoadState("networkidle");

    // By its own label, not `/enable/i`: the Work page has seven switches now
    // (the master and six options), where the page this replaced had one.
    const releases = page.getByRole("switch", { name: /^releases$/i });
    await expect(releases).toHaveAttribute("aria-checked", "true");

    const off = page.waitForResponse((res) =>
      res.url().includes("/capabilities/work"),
    );
    await releases.click();
    expect((await off).ok()).toBe(true);
    await expect(sidebarReleases).toHaveCount(0);

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("switch", { name: /^releases$/i }),
    ).toHaveAttribute("aria-checked", "false", { timeout: 10_000 });
    await expect(sidebarReleases).toHaveCount(0);

    const on = page.waitForResponse((res) =>
      res.url().includes("/capabilities/work"),
    );
    await page.getByRole("switch", { name: /^releases$/i }).click();
    expect((await on).ok()).toBe(true);
    await expect(sidebarReleases).toBeVisible();
  });

  test("the master goes off, and the whole capability leaves with it", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const ts = Date.now();
    await registerAndVerify(page, `master${ts}@example.com`, "GoodPassw0rd");
    const { slug } = await createProjectViaWizard(
      page,
      `Mast${ts}`.slice(0, 20),
    );

    const sidebarFolios = page.locator(`a[href="/${slug}/folios"]`);
    await expect(sidebarFolios).toBeVisible();

    await page.goto(`/${slug}/settings/knowledge`);
    await page.waitForLoadState("networkidle");

    const master = page.getByRole("switch", { name: /enable/i });
    await expect(master).toHaveAttribute("aria-checked", "true");

    const saved = page.waitForResponse((res) =>
      res.url().includes("/capabilities/knowledge"),
    );
    await master.click();
    expect((await saved).ok()).toBe(true);

    // The entry goes, and the settings page it was turned off from stays
    // reachable - a page you cannot reach is a capability you cannot turn back
    // on, which is why the four are listed unconditionally.
    await expect(sidebarFolios).toHaveCount(0);
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("switch", { name: /enable/i })).toHaveAttribute(
      "aria-checked",
      "false",
      { timeout: 10_000 },
    );

    // And back. Nothing was deleted, so the folios are where they were.
    const back = page.waitForResponse((res) =>
      res.url().includes("/capabilities/knowledge"),
    );
    await page.getByRole("switch", { name: /enable/i }).click();
    expect((await back).ok()).toBe(true);
    await expect(sidebarFolios).toBeVisible();
  });
});
