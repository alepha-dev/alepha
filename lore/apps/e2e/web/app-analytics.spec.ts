import { expect, test } from "./_fixtures.ts";
import {
  createProjectViaWizard,
  registerAndVerify,
  setCapability,
} from "./_helpers.ts";

/**
 * The Analytics tab on a seeded app: the range, a filter picked off a
 * leaderboard, and Compare, each driving the whole page from the URL.
 *
 * `apps.spec.ts` walks an app from its creation and pins the numbers of one
 * visit; this file seeds two visitors through ingest and walks the page's
 * controls over them.
 */
test.describe("App analytics", () => {
  test("range, filter and compare drive the whole page", async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(
      page,
      `analytics${t}@example.com`,
      "AppAnalyticsTest123!",
    );
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      `AN${t}`.slice(0, 20),
    );
    await setCapability(page, projectId, "ship", { options: { track: true } });

    // One deployed copy and its sigil, through the API: the dialogs that make
    // them are `apps.spec.ts`'s subject.
    const token = await page.evaluate(async (projectId) => {
      const post = (path: string, body: unknown) =>
        fetch(path, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      const copy = { app: "shop", env: "production" };
      const created = await post(`/api/projects/${projectId}/apps`, copy);
      if (!created.ok) throw new Error(`createApp ${created.status}`);
      const minted = await post(`/api/projects/${projectId}/sigils`, copy);
      if (!minted.ok) throw new Error(`createSigil ${minted.status}`);
      return ((await minted.json()) as { token: string }).token;
    }, projectId);

    // ⚠️ Through the isolated `request` fixture, never the page: the page's
    // `fetch` attaches the session bearer, which would replace the sigil's.
    const report = (data: Record<string, unknown>) =>
      request.post(`${baseURL}/sigils/ingest`, {
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        data,
      });

    // Two visitors: one from France reading two pages, one from Germany
    // reading one. Three views, two visits.
    expect(
      (
        await report({
          views: [{ path: "/checkout", entry: true }, { path: "/pricing" }],
          country: "FR",
          device: "mobile",
          visitor: `v-fr-${t}`,
        })
      ).status(),
    ).toBe(204);
    expect(
      (
        await report({
          views: [{ path: "/pricing", entry: true }],
          country: "DE",
          device: "desktop",
          visitor: `v-de-${t}`,
        })
      ).status(),
    ).toBe(204);

    const analytics = `/${projectSlug}/apps/shop/production/analytics`;
    const visitors = page.getByTestId("insights-visitors-value");
    const visits = page.getByTestId("insights-visits-value");
    const views = page.getByTestId("insights-views-value");
    const range = page.getByTestId("app-range");

    await test.step("the page opens on this month, to date", async () => {
      await page.goto(analytics);
      await page.waitForLoadState("networkidle");

      await expect(
        range.getByRole("radio", { name: "This month", exact: true }),
      ).toBeChecked({ timeout: 15_000 });
      await expect(page.getByTestId("insights-window")).toContainText(
        "to date",
      );
      await expect(visitors).toHaveText("2");
      await expect(visits).toHaveText("2");
      await expect(views).toHaveText("3");

      // Every leaderboard has its two columns.
      const countries = page.getByTestId("insights-countries");
      await expect(
        countries.getByText("Visitors", { exact: true }),
      ).toBeVisible();
      await expect(countries.getByText("Views", { exact: true })).toBeVisible();
    });

    await test.step("a preset changes the window, in the URL", async () => {
      await range.getByRole("radio", { name: "7 days", exact: true }).click();
      await expect(page).toHaveURL(/range=7d/, { timeout: 15_000 });
      // Everything was reported today, so every window holding today agrees.
      await expect(views).toHaveText("3");

      // Last month predates this app's first visitor: views only, said so.
      await range
        .getByRole("radio", { name: "Last month", exact: true })
        .click();
      await expect(page).toHaveURL(/range=lastMonth/, { timeout: 15_000 });
      await expect(page.getByTestId("insights-views-only")).toContainText(
        "not counted this far back",
        { timeout: 15_000 },
      );
      await expect(visitors).toHaveText("-");
      await expect(views).toHaveText("0");

      await range
        .getByRole("radio", { name: "This month", exact: true })
        .click();
      await expect(page).toHaveURL(/range=thisMonth/, { timeout: 15_000 });
      await expect(views).toHaveText("3", { timeout: 15_000 });
      await expect(visitors).toHaveText("2");
      // Visitors are counted from this app's first visit, today: a banner
      // says so whenever that day is later than the month's first.
      await expect(page.getByTestId("insights-views-only")).not.toContainText(
        "not counted this far back",
      );
    });

    await test.step("a leaderboard row filters the whole page", async () => {
      await page
        .getByTestId("insights-countries")
        .getByTestId("insights-row")
        .filter({ hasText: "DE" })
        .click();

      await expect(page).toHaveURL(/country=DE/, { timeout: 15_000 });
      await expect(page.getByTestId("insights-filters")).toContainText("DE");
      // Narrowed together: visitors and visits as well as views.
      await expect(visitors).toHaveText("1", { timeout: 15_000 });
      await expect(visits).toHaveText("1");
      await expect(views).toHaveText("1");
      await expect(
        page.getByTestId("insights-top-paths").getByText("/checkout"),
      ).toHaveCount(0);
    });

    await test.step("Compare asks for the window before, and survives a reload", async () => {
      const compared = page.waitForRequest(
        (req) =>
          req.url().includes("/insights?") && /compare=true/.test(req.url()),
      );
      await page.getByTestId("app-compare").click();
      await expect(page).toHaveURL(/compare=true/, { timeout: 15_000 });
      await compared;
      await expect(page.getByTestId("insights-window")).toContainText(
        "against the same length before",
      );
      // Nothing was reported before this month: no previous number, so no
      // delta rather than an infinite one.
      await expect(page.getByTestId("insights-visitors-delta")).toHaveCount(0);

      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page).toHaveURL(/compare=true/);
      await expect(page).toHaveURL(/country=DE/);
      await expect(page.getByTestId("app-compare")).toBeChecked({
        timeout: 15_000,
      });
      await expect(visitors).toHaveText("1", { timeout: 15_000 });
    });

    await test.step("clearing the filter widens the page again", async () => {
      await page
        .getByTestId("insights-filters")
        .getByRole("button", { name: /Clear the Country filter/ })
        .click();
      await expect(page).not.toHaveURL(/country=/, { timeout: 15_000 });
      await expect(visitors).toHaveText("2", { timeout: 15_000 });
      await expect(views).toHaveText("3");
    });

    await test.step("under Bots the page shows views only", async () => {
      // A declared crawler, stamped `bot` as an app's proxy stamps it.
      expect(
        (
          await report({
            views: [{ path: "/robots", entry: true }],
            country: "US",
            device: "desktop",
            traffic: "bot",
            visitor: `v-bot-${t}`,
          })
        ).status(),
      ).toBe(204);

      await page
        .getByTestId("app-traffic")
        .getByRole("radio", { name: "Bots", exact: true })
        .click();
      await expect(page).toHaveURL(/traffic=bots/, { timeout: 15_000 });
      await expect(views).toHaveText("1", { timeout: 15_000 });
      await expect(visitors).toHaveText("-");
      await expect(page.getByTestId("insights-visitors")).toContainText(
        "Bots have no visits",
      );
      // The leaderboards keep their views and lose their visitors.
      await expect(
        page.getByTestId("insights-countries").getByText("Views", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByTestId("insights-countries").getByText("Visitors", {
          exact: true,
        }),
      ).toHaveCount(0);
    });
  });
});
