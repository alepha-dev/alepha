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
});
