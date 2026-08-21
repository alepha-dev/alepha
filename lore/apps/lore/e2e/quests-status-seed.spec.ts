import { expect, test } from "@playwright/test";
import {
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * `?status=` on the quests page — the drill-through target a dashboard card
 * links to.
 *
 * The filtering itself is the easy half. The half that needs an e2e is the
 * one #156 got wrong: the removed `?view=kanban` param seeded page state
 * from the URL through an effect that also RESTORED the param when it found
 * it missing, and `useRouterState` is a global store — so the outgoing
 * render on the way out of the page saw the next route's empty query and
 * bounced the user straight back. Every sidebar link was dead, and nothing
 * short of driving a real navigation catches that.
 *
 * So the assertions here are: the seed applies, an unknown value is ignored
 * rather than fatal, and — the point — leaving the page actually leaves it.
 */
test.describe("Quests — ?status= seeds the filter", () => {
  test("seeds on arrival, ignores nonsense, and never traps the reader", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    const email = `qstatus${t}@example.com`;
    const password = "GoodPassw0rd";

    await registerAndVerify(page, email, password);
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `QS${t}`.slice(0, 20),
    );

    const newTitle = `Untouched${t}`;
    const acceptedTitle = `InFlight${t}`;

    for (const title of [newTitle, acceptedTitle]) {
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
        // GET, not POST: an `$action` with no `body` schema derives a GET
        // route, and `acceptQuest` has none.
        await page.evaluate(async (id) => {
          const r = await fetch(`/api/acceptQuest/${id}`, {
            credentials: "include",
          });
          if (!r.ok) throw new Error(`accept ${r.status}`);
        }, quest.id);
      }
    }

    /**
     * ⚠️ Every assertion below is scoped to the TABLE, never to the page.
     * An accepted quest is also listed in the questlog rail down the left of
     * this page, so a page-wide text matcher finds it whatever the filter
     * says — and that rail is precisely why a dashboard drill-through targets
     * `status=new`.
     */
    const table = page.locator("[data-testid=quests-table]");

    await test.step("no param means no filter", async () => {
      await page.goto(`/${slug}/`);
      await page.waitForLoadState("networkidle");
      await expect(table.getByText(newTitle)).toHaveCount(1, {
        timeout: 15_000,
      });
      await expect(table.getByText(acceptedTitle)).toHaveCount(1);
    });

    await test.step("an unknown status is ignored, not fatal", async () => {
      // "Ignored" means the page behaves exactly as if the param were not
      // there — not "shows nothing", and not "resets the reader's filter".
      await page.goto(`/${slug}/?status=not-a-status`);
      await page.waitForLoadState("networkidle");
      await expect(table.getByText(newTitle)).toHaveCount(1, {
        timeout: 15_000,
      });
      await expect(table.getByText(acceptedTitle)).toHaveCount(1);
    });

    await test.step("?status=new narrows the list", async () => {
      await page.goto(`/${slug}/?status=new`);
      await page.waitForLoadState("networkidle");
      await expect(table.getByText(newTitle)).toHaveCount(1, {
        timeout: 15_000,
      });
      await expect(table.getByText(acceptedTitle)).toHaveCount(0);
    });

    await test.step("the sidebar still works from a seeded URL", async () => {
      // The #156 regression, exactly: from a page whose state came out of the
      // query string, click away and stay away.
      await page.getByRole("link", { name: "Reports", exact: true }).click();
      await page.waitForURL(`**/${slug}/reports`, { timeout: 15_000 });

      // Not just "the URL changed once" — the bounce happened on the OUTGOING
      // render, so it looked like an instant return. Give it a real chance to
      // fire before believing the navigation stuck.
      await page.waitForLoadState("networkidle");
      expect(new URL(page.url()).pathname).toBe(`/${slug}/reports`);
      expect(new URL(page.url()).search).toBe("");
    });

    await test.step("the seed does not become the reader's stored filter", async () => {
      await page.goto(`/${slug}/`);
      await page.waitForLoadState("networkidle");
      // Two things at once. The param must not reappear in the address bar
      // (the #156 write-back), and the seed must not have been persisted as
      // though the reader had chosen it: AlephaTable writes filters from
      // `form:change` / `form:submit:success`, never on mount, so arriving
      // through a link leaves the stored preference alone.
      expect(new URL(page.url()).search).toBe("");
      await expect(table.getByText(acceptedTitle)).toHaveCount(1, {
        timeout: 15_000,
      });
    });
  });
});
