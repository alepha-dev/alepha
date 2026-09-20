import { expect, test } from "./_fixtures.ts";
import {
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * Home is the only SSR'd route, and a signed-in visitor with projects gets the
 * board there: the rows come from the bootstrap atom, so the table IS in the
 * server HTML, and its Last activity column is a relative time.
 *
 * A relative time computed with `fromNow()` mismatches between the server
 * render and client hydration (clock drift, or a unit boundary crossed between
 * the two) → React #418. `TimeAgo` is what avoids it: the absolute form is
 * what it renders on the server, and the relative one appears after hydration.
 *
 * The mismatch itself is timing-dependent (it only fires on a unit boundary),
 * so a "no console error" check would be a false green. This asserts the
 * deterministic mechanism instead: the relative time is NOT server-rendered
 * but DOES appear after hydration.
 *
 * ⚠️ It used to assert the same thing about the dashboard header's "Refreshed
 * <time>" standfirst. That board is gone; the hazard it guarded is not, and it
 * now sits in a column on every row.
 *
 * The column is now "today" / "3d ago", counted from `getHomeBoard`'s last
 * activity. That request is a `useQuery`, which fetches from an effect, so the
 * cell is empty in the server HTML by construction and fills after
 * hydration: the same guarantee, reached another way, and asserted the same
 * way. A project made seconds ago reads "today".
 */
test.describe("Home (SSR)", () => {
  test("relative times are client-only, not in the SSR HTML", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `home${t}@example.com`;
    const projectTitle = `Home${t}`.slice(0, 20);

    await registerAndVerify(page, email, "HomeTest123!");
    await createProjectViaWizard(page, projectTitle);

    // Raw server-rendered HTML for the authenticated home page (page.request
    // shares the browser context's session cookie).
    const html = await (await page.request.get("/")).text();

    // The table IS server-rendered (the project title is in the SSR HTML)...
    expect(html).toContain(projectTitle);
    // ...but no relative time is: not the old `fromNow` wording, and not the
    // Last activity cell, which reads "today" once the client has it.
    expect(html).not.toContain("seconds ago");
    expect(html).not.toContain("minute ago");
    expect(html).not.toMatch(/>today</i);

    // After hydration it appears client-side.
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/^today$/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});

/**
 * The logged-out call to action has to survive a *client-side* transition, not
 * just a direct load.
 *
 * `AuthRegisterPage` seeds `?redirect=` on arrival so the post-register flow
 * knows where to land. It used to build that URL from `window.location.href` —
 * correct on a direct load, wrong when clicking through from Home, because the
 * router renders the new page before it writes history and the effect still
 * saw `/`. The CTA rewrote the address back to Home and read as a dead link.
 *
 * Every register spec navigates straight to `/auth/register`, so none of them
 * exercised the transition. This one clicks the button a signed-out visitor
 * actually clicks.
 */
test.describe("Home (mobile chrome)", () => {
  test("a signed-in header is one account button, with the settings in its menu", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    /*
     * Feedback #P2144: the header carried eight icon buttons on a phone -
     * create, search, repository, bell, language, palette, dark, account -
     * all the same weight, and half of them settings a reader changes about
     * once. Signed in, those three are now submenus of the account menu
     * (`ButtonSettings`), at every width.
     *
     * ⚠️ Asserted at 411px, the width the earlier mobile reports came in
     * at, and then again wide: the menu is what keeps them reachable on a
     * phone, so a test that only checked that the buttons left would pass
     * against a build that had simply deleted them.
     */
    await registerAndVerify(
      page,
      `mob${Date.now()}@example.com`,
      "MobileTest123!",
    );

    // Lore's own labels: the submenus in the menu, and what the buttons
    // would be called if they were still drawn.
    const settings = ["Language", "Theme", "Display Mode"];
    // Only the account button: search, create and the bell are the PROJECT
    // shell's, passed through `before`, and home has none of them.
    const work = ["Account menu"];

    for (const width of [411, 1200]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      for (const name of work) {
        await expect(page.getByLabel(name).first()).toBeVisible({
          timeout: 15_000,
        });
      }
      for (const name of settings) {
        await expect(page.getByLabel(name, { exact: true })).toHaveCount(0);
      }

      await page.getByLabel("Account menu").click();
      for (const name of settings) {
        await expect(
          page.getByRole("menuitem", { name, exact: true }),
        ).toBeVisible();
      }
      await page.keyboard.press("Escape");
    }

    /*
     * ⚠️ And the account area, which is `@alepha/ui`'s own `AccountHeader`:
     * it draws `ButtonSettings` with the kit's catalogue labels, which in
     * English are the same three. It is where a phone reader changed language
     * and theme when the header still hid them as buttons, so it has to keep
     * offering them.
     */
    await page.setViewportSize({ width: 411, height: 800 });
    await page.goto("/account");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Account menu").click({ timeout: 15_000 });
    for (const name of settings) {
      await expect(
        page.getByRole("menuitem", { name, exact: true }),
      ).toBeVisible();
    }
  });
});

/**
 * The landing page itself: the table of projects and the bars beside them.
 *
 * Two things here cannot be covered anywhere else.
 *
 * **The bars are one request, the rows are another.** The rows come from the
 * bootstrap atom and the bars from `getHomeBoard`, so a page that renders its
 * rows proves nothing about the aggregate behind them.
 *
 * **The table is the list at every width.** #1754, from feedback #2084 on
 * Chrome/Android at 412x924: the landing page had no way to reach a project
 * at all, because the one surface carrying the list was `lg:flex`. The table
 * is not breakpoint-gated, which is what those widths pin. The Recent
 * activity panel that used to sit beside it was deleted in #E64.
 */
test.describe("Home (board)", () => {
  test("lists projects and draws momentum", async ({ page }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `board${t}@example.com`, "BoardTest123!");

    // The first goes through the wizard because that is what creates the
    // session's project context; the rest go through the API, which is far
    // cheaper than three more wizard runs.
    const { slug: firstSlug } = await createProjectViaWizard(
      page,
      `Board${t}`.slice(0, 20),
    );
    await apiPost(page, "createProject", {
      title: `Quiet${t}`.slice(0, 20),
    });
    const busy = await apiPost<{ id: number }>(page, "createProject", {
      title: `Busy${t}`.slice(0, 20),
    });
    // Three writes in one project and none in the other, so the momentum
    // column has something to tell apart.
    for (let i = 0; i < 3; i++) {
      await apiPost(page, "createQuest", {
        projectId: busy.id,
        title: `Busy quest ${i + 1}`,
        area: "general",
        priority: "medium",
      });
    }

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const table = page.getByRole("table");
    await expect(
      table.getByRole("row").filter({ hasText: `Busy${t}`.slice(0, 20) }),
    ).toBeVisible({ timeout: 15_000 });
    // Three projects and the header row.
    await expect(table.getByRole("row")).toHaveCount(4);

    // The open-quest count is the project's own, not the account's.
    const busyRow = table
      .getByRole("row")
      .filter({ hasText: `Busy${t}`.slice(0, 20) });
    // The Open column is a link per feature, to that feature's page; the
    // quest link names its count.
    const openQuests = busyRow.getByRole("link", { name: "3 open quests" });
    await expect(openQuests).toBeVisible();
    await expect(openQuests).toHaveAttribute("href", /\/quests$/);

    // The bars come from `getHomeBoard`, so this is the aggregate's assertion:
    // the label names the window and the count the query returned.
    await expect(
      busyRow.getByRole("img", { name: /events over the last 14 days/i }),
    ).toBeVisible();

    // A row is a link to its project, which is the page's primary job.
    await table
      .getByRole("row")
      .filter({ hasText: `Board${t}`.slice(0, 20) })
      .click();
    await page.waitForURL(`**/${firstSlug}**`, { timeout: 15_000 });
  });

  test("narrows the table by ownership and by activity", async ({ page }) => {
    test.setTimeout(120_000);
    /*
     * The wiring only: both filters are on the bar from the start, and each
     * value reaches the table. What counts as dormant, and the fallback
     * before the board arrives, are `homeProjectsFilter.spec.ts`'s: a fresh
     * account owns every project it has, and nothing here is a week old.
     */
    const t = Date.now();
    await registerAndVerify(page, `filt${t}@example.com`, "FilterTest123!");
    const title = `Filt${t}`.slice(0, 20);
    await createProjectViaWizard(page, title);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const row = page.getByRole("table").getByRole("row").filter({
      hasText: title,
    });
    await expect(row).toBeVisible({ timeout: 15_000 });

    const pick = async (filter: string, option: string) => {
      await page.getByRole("combobox", { name: filter }).click();
      await page.getByRole("option", { name: option }).click();
      // Base UI parks `pointer-events: none` on <body> for a beat after a
      // popup closes, and the next click in that window does nothing.
      await page.waitForFunction(
        () => document.body.style.pointerEvents !== "none",
      );
    };

    await pick("Ownership", "Shared");
    await expect(row).toHaveCount(0);
    await pick("Ownership", "Mine");
    await expect(row).toBeVisible();

    await pick("Activity", "Dormant (7d+)");
    await expect(row).toHaveCount(0);
    await pick("Activity", "Active (7d)");
    await expect(row).toBeVisible();
  });

  test("keeps the table at every width", async ({ page }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `land${t}@example.com`, "GoodPassw0rd");
    const { slug } = await createProjectViaWizard(page, `LD${t}`.slice(0, 20));

    // ⚠️ 768 is asserted alongside 412 on purpose. `useIsMobile` flips at
    // 767, so anything hung off it would leave 768-1023 in neither state -
    // the same bug in a narrower band, found months later.
    for (const width of [412, 768]) {
      await page.setViewportSize({ width, height: 924 });
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      await expect(
        page.getByRole("row").filter({ hasText: `LD${t}` }),
        `no project row at ${width}px`,
      ).toBeVisible({ timeout: 15_000 });
    }

    // And the point of all of it: a project is one tap away.
    await page
      .getByRole("row")
      .filter({ hasText: `LD${t}` })
      .click();
    await page.waitForURL(`**/${slug}**`, { timeout: 15_000 });

    // And at desktop width, still the same list.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("row").filter({ hasText: `LD${t}` }),
    ).toBeVisible({ timeout: 15_000 });
  });
});

/**
 * The switcher's own cap, which is the last one left: the landing page lists
 * every project and pages them, so `RECENT_PROJECTS_CAP` narrows the switcher
 * menu alone.
 *
 * Eleven is the fixture on purpose - the smallest number that truncates a cap
 * of ten. A test built on ten would pass against a cap that had stopped
 * working.
 */
test.describe("Home (switcher cap)", () => {
  test("caps the switcher at ten and keeps the project you are looking at", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `cap${t}@example.com`, "CapTest123!");

    const { slug: firstSlug } = await createProjectViaWizard(
      page,
      `Cap${t}`.slice(0, 20),
    );
    for (const title of [
      "Atlas",
      "Beacon",
      "Cinder",
      "Drift",
      "Ember",
      "Forge",
      "Gale",
      "Harbor",
      "Ingot",
      "Jetty",
    ]) {
      await apiPost(page, "createProject", {
        title: `${title}${t}`.slice(0, 20),
      });
    }

    // The landing page lists every one of them: no cap, and the footer counts
    // what the table holds.
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("table").getByRole("row")).toHaveCount(12, {
      timeout: 15_000,
    });

    await page.goto("/account/projects");
    await expect(page.getByTestId("account-project-row")).toHaveCount(11);

    // Every one of them was created by this account, so every row says Owner.
    // The badge is derived from the member rank, so a page that rendered no
    // badge at all would still pass a bare row count.
    await expect(page.getByText("Owner").first()).toBeVisible();

    /*
     * Feedback #P2146: the quota was only ever shown as a refusal, so a
     * reader met the number at the moment it stopped them.
     *
     * ⚠️ Eleven OWNED, and this account owns all eleven - which is exactly
     * why the assertion names the number rather than just the element: a
     * counter reading `projects.length` would also say 11 here and would be
     * wrong the moment somebody is invited to a project they do not own.
     * The limit is 100 since #Q2013.
     */
    await expect(page.getByTestId("project-quota")).toHaveText(
      "11 of 100 projects owned",
    );

    // The switcher caps, and always keeps the project you are looking at.
    // `firstSlug` is the LEAST recently updated of the eleven (it was created
    // first), so it is exactly the case that falls outside the top ten - open
    // its switcher and it must still be listed, or the checkmark disappears
    // and the menu reads as though you are nowhere.
    await page.goto(`/${firstSlug}/`);
    await page.getByTestId("project-switcher").click();
    await expect(page.getByTestId("switcher-all-projects")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole("menuitem").filter({ hasText: `Cap${t}`.slice(0, 20) }),
    ).toBeVisible();

    // Every project row is a real anchor pointing at that project's slug, not
    // a button with an onClick - the difference is invisible on a plain click
    // and is the whole affordance on shift/⌘/middle-click (Lore feedback #61).
    // Asserted on a row that is NOT the active one, so a fix that special-cased
    // the current project would not pass.
    await expect(
      page.getByRole("menuitem").filter({ hasText: `Jetty${t}`.slice(0, 20) }),
    ).toHaveAttribute("href", /^\/[a-z0-9-]+$/);
  });
});

test.describe("Home (signed out)", () => {
  test("'Start your first project' reaches the register page", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /start your first project/i }).click();

    await expect(page).toHaveURL(/\/auth\/register\?/);
    // The intent survives, and with it the message and the seeded redirect —
    // landing on a bare register form would mean the intent was dropped.
    await expect(page).toHaveURL(/intent=createProject/);
    await expect(page).toHaveURL(/redirect=/);
    await expect(page.getByText(/before creating a project/i)).toBeVisible();
  });

  test("'Already registered? Sign in' reaches the login page", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /already registered/i }).click();

    await expect(page).toHaveURL(/\/auth\/login/);
  });
});
