import { expect, test } from "@playwright/test";

import {
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * The signed-in landing page, end to end.
 *
 * Three things here cannot be covered anywhere else.
 *
 * **The seed-versus-emptied ambiguity.** A board with no cards and a board
 * that was never seeded are the same zero rows; only `dashboard_settings`
 * tells them apart. The unit specs pin the service, but only a real reload
 * proves the reader who cleared their board does not find it repopulated.
 *
 * **The drill-through.** The Active Quests tile counts `new + accepted` and
 * navigates to `status=new`, deliberately. That divergence only means
 * anything if clicking it lands on a list that actually filters.
 *
 * **One failing tile costs a tile.** Cards read unrelated tables, so a
 * neighbour losing its scope must not take the page with it.
 */
test.describe("Dashboard", () => {
  test("seeds, resolves, drills through, and stays empty when emptied", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    const email = `dash${t}@example.com`;
    const password = "GoodPassw0rd";

    await registerAndVerify(page, email, password);
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `DB${t}`.slice(0, 20),
    );

    const acceptedTitle = `InFlight${t}`;
    for (const title of [`Todo${t}`, `Todo2${t}`, acceptedTitle]) {
      const quest = await apiPost<{ id: number }>(page, "createQuest", {
        projectId,
        title,
        description: "seeded",
        area: "Main",
        priority: "medium",
        objectives: [],
        attachments: [],
      });
      if (title === acceptedTitle) {
        // GET, not POST: an `$action` with no `body` schema derives a GET.
        await page.evaluate(async (id) => {
          const r = await fetch(`/api/acceptQuest/${id}`, {
            credentials: "include",
          });
          if (!r.ok) throw new Error(`accept ${r.status}`);
        }, quest.id);
      }
    }

    await test.step("a first visit seeds the default board", async () => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const cards = page.getByTestId("dashboard-card");
      await expect(cards).toHaveCount(3, { timeout: 15_000 });
      // No beacon app, so no visitors card: a metric with no data available
      // is not offered, and therefore not seeded either.
      await expect(page.locator('[data-metric="uniqueVisitors"]')).toHaveCount(
        0,
      );
    });

    await test.step("the quests tile counts new + accepted", async () => {
      const card = page.locator('[data-metric="activeQuests"]');
      await expect(card).toContainText("3", { timeout: 15_000 });
      await expect(card).toContainText("1 accepted, 2 new");
    });

    await test.step("the rail agrees with the tile", async () => {
      // Two views of one number, on screen together. They are counted through
      // the same `OpenQuestScope` precisely so this can never disagree.
      await expect(page.getByTestId("dashboard-rail-project")).toContainText(
        "3",
      );
    });

    await test.step("clicking it opens status=new, not the filter it counted", async () => {
      await page
        .locator('[data-metric="activeQuests"]')
        .getByTestId("dashboard-card-open")
        .click();
      await page.waitForURL(`**/${slug}/?status=new`, { timeout: 15_000 });
      await page.waitForLoadState("networkidle");

      // The divergence, made visible: the tile counted 3 (new + accepted) and
      // this list holds the 2 the footer called "new".
      //
      // ⚠️ Scoped to the TABLE, not to the page. The accepted quest is still
      // on screen, in the questlog rail down the left — which is the entire
      // reason this drill-through targets `status=new` rather than the filter
      // the tile counted. A page-wide text assertion here fails, and it fails
      // by proving the design right.
      const table = page.locator("[data-testid=quests-table]");
      await expect(table.getByText(acceptedTitle)).toHaveCount(0);
      await expect(table.locator("tbody tr")).toHaveCount(2, {
        timeout: 15_000,
      });
    });

    await test.step("the Add-card panel is generated from the registry", async () => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      await page.getByTestId("dashboard-add").click();

      const rows = page.getByTestId("dashboard-catalogue-row");
      await expect(rows).toHaveCount(4, { timeout: 15_000 });

      await page.locator('[data-metric="activeQuests"]').last().click();
      await page.getByTestId("dashboard-scope-project").first().click();
      // The metric's own filter step, read off its Zod schema. Dropping
      // `Accepted` narrows the card to new quests only.
      await page
        .getByTestId("dashboard-filter-option")
        .filter({ hasText: "Accepted" })
        .click();
      await page.getByTestId("dashboard-catalogue-save").click();

      await expect(page.getByTestId("dashboard-card")).toHaveCount(4, {
        timeout: 15_000,
      });
      const added = page.getByTestId("dashboard-card").last();
      await expect(added).toContainText("2");
      await expect(added).toContainText("0 accepted, 2 new");
    });

    await test.step("an emptied board stays empty across a reload", async () => {
      for (let i = 0; i < 4; i++) {
        const card = page.getByTestId("dashboard-card").first();
        await card.getByRole("button", { name: "Card options" }).click();
        await page.getByRole("menuitem", { name: "Delete card" }).click();
        await page
          .getByRole("button", { name: "Delete card", exact: true })
          .last()
          .click();
        await expect(page.getByTestId("dashboard-card")).toHaveCount(3 - i, {
          timeout: 15_000,
        });
      }

      await expect(page.getByTestId("dashboard-empty")).toBeVisible();

      // The whole reason `dashboard_settings` exists. This second visit sees
      // zero rows exactly as the very first one did, and must not re-seed.
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("dashboard-empty")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByTestId("dashboard-card")).toHaveCount(0);
    });

    await test.step("reset restores the default set", async () => {
      await page.getByTestId("dashboard-reset").click();
      await page
        .getByRole("button", { name: "Reset layout", exact: true })
        .last()
        .click();
      await expect(page.getByTestId("dashboard-card")).toHaveCount(3, {
        timeout: 15_000,
      });
    });
  });

  /**
   * #1743. Every card's options button was 22x22, two pixels short of WCAG
   * 2.2's Target Size (Minimum) in each direction - and the same size on a
   * desktop, where a mouse makes it workable and a thumb never does.
   *
   * Asserted at a phone width because that is where it matters, though the
   * measurement is viewport-independent.
   */
  test("each card's options button meets the 24px minimum target size", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const t = Date.now();

    await registerAndVerify(page, `dashtap${t}@example.com`, "GoodPassw0rd");
    await createProjectViaWizard(page, `DT${t}`.slice(0, 20));

    await page.setViewportSize({ width: 411, height: 845 });
    await page.goto("/");
    const cards = page.getByTestId("dashboard-card");
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });

    const options = page.getByRole("button", { name: "Card options" });
    const count = await options.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const box = await options.nth(i).boundingBox();
      expect(box, `card ${i} options has no box`).not.toBeNull();
      expect(box!.width, `card ${i} options width`).toBeGreaterThanOrEqual(24);
      expect(box!.height, `card ${i} options height`).toBeGreaterThanOrEqual(
        24,
      );
    }
  });

  /**
   * #1754, from feedback #2084 on Chrome/Android at 412x924: no way to select
   * a project from `/` at all.
   *
   * This page renders no `AppShell`, so it has no sidebar, no sheet and no
   * trigger - and `DashboardRail`, which is `hidden ... lg:flex`, was the only
   * thing carrying the project list, the new-project action and the Spotlight
   * button. #1649's guard runs on a PROJECT page and could never have caught
   * this: the landing page is a different tree that was never covered.
   *
   * ⚠️ 768 is asserted alongside 412 on purpose. The rail hides at `lg` (1024)
   * while `useIsMobile` flips at 767, so a fix hung off `useIsMobile` would
   * have left 768-1023 with neither - the same bug in a narrower band. The
   * inline section is `lg:hidden`, the exact complement of the rail's
   * `lg:flex`, and these two widths are what pins that.
   */
  test("the landing page reaches a project below lg", async ({ page }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `land${t}@example.com`, "GoodPassw0rd");
    const { slug } = await createProjectViaWizard(page, `LD${t}`.slice(0, 20));

    const section = page.getByTestId("dashboard-projects-section");
    const rail = page.getByTestId("dashboard-rail");

    for (const width of [412, 768]) {
      await page.setViewportSize({ width, height: 924 });
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      await expect(section, `no projects section at ${width}px`).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        rail,
        `the rail should be hidden at ${width}px`,
      ).toBeHidden();

      // ⚠️ The section's rows carry their OWN testid. Both surfaces are in the
      // DOM at every width - this one is CSS-hidden, not unmounted - so
      // reusing the rail's name made every page-wide selector on it resolve to
      // two elements per project. That is how the first draft of this shipped,
      // and it took `home.spec` (ten rows counted for five projects) and this
      // file's own drill-through down with it.
      // Scoped to the section, because the RAIL is in the DOM here too - it is
      // `hidden lg:flex`, CSS-hidden rather than unmounted, so a page-wide
      // count cannot tell the two apart. Which is exactly the point.
      await expect(
        section.getByTestId("dashboard-rail-project"),
        `the section reuses the rail's row testid at ${width}px`,
      ).toHaveCount(0);
      await expect(
        section.getByTestId("dashboard-projects-project"),
      ).toHaveCount(1);
      await expect(rail.getByTestId("dashboard-rail-project")).toHaveCount(1);

      // Both of the rail's other doors are here too, not just the list.
      await expect(page.getByTestId("dashboard-projects-search")).toBeVisible();
      await expect(page.getByTestId("dashboard-projects-new")).toBeVisible();

      // The greeting takes the whole line instead of absorbing the shortfall
      // the two actions leave: "Welco..." in the report's screenshot.
      const truncated = await page
        .locator("h1")
        .first()
        .evaluate((el) => el.scrollWidth > el.clientWidth);
      expect(truncated, `greeting truncated at ${width}px`).toBe(false);
    }

    // And the point of all of it: a project is one tap away.
    await page.setViewportSize({ width: 412, height: 924 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await section.getByRole("link", { name: new RegExp(`LD${t}`) }).click();
    await page.waitForURL(`**/${slug}**`, { timeout: 15_000 });

    // At `lg` the rail is back and the section is gone - complementary, never
    // both and never neither.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(rail).toBeVisible({ timeout: 15_000 });
    await expect(section).toBeHidden();
  });
});
