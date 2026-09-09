import { expect, test } from "./_fixtures.ts";
import {
  apiPath,
  apiPost,
  createProjectViaWizard,
  newUserContext,
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
      // `/quests`, not the project root: the list moved when Activity took
      // `/`. The tile names its destination by route, so the catalog needed
      // no change - only this URL, and the matching unit assertion in
      // `test/dashboard-links.spec.ts`.
      await page.waitForURL(`**/${slug}/quests?status=new`, {
        timeout: 15_000,
      });
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

/**
 * The PROJECT board, which is a different surface from the one above: shared
 * rather than per user, at the project root, and empty until somebody fills
 * it.
 *
 * Four things here cannot be covered anywhere else.
 *
 * **The route move.** `/:projectSlug` renders the board and `/activity` still
 * renders the feed. It is the change most likely to break something at a
 * distance, and only a real navigation proves it.
 *
 * **The empty state as the landing page.** Nothing seeds a project board, so
 * this is what most projects show on their first visit and possibly forever.
 *
 * **The add path.** With no seeder it is the ONLY way a board ever has
 * anything on it, so it is the one flow that must work end to end.
 *
 * **A member without the write permission gets no controls.** Under
 * `project:update` that is most real members, not a corner case.
 */
test.describe("Project dashboard", () => {
  test("lands on the board, adds a card, and survives a reload", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `pdash${t}@example.com`, "GoodPassw0rd");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `PB${t}`.slice(0, 20),
    );

    const parked = await apiPost<{ id: number }>(page, "createQuest", {
      projectId,
      title: `Parked${t}`,
      description: "seeded",
      area: "Main",
      priority: "medium",
      objectives: [],
      attachments: [],
    });
    // ⚠️ HELD, so the card's number is 1 rather than 0. A zero would also be
    // what a card that never resolved shows in a world where the value
    // defaulted, so it proves less than it looks like it does; a 1 can only
    // come from a real read.
    const holdUrl = (await apiPath(page, "holdQuest")).replace(
      ":id",
      String(parked.id),
    );
    await page.evaluate(async (url) => {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: "waiting on the client" }),
      });
      if (!r.ok) throw new Error(`hold ${r.status} ${await r.text()}`);
    }, holdUrl);

    await test.step("the project root renders the board, not the feed", async () => {
      await page.goto(`/${slug}`);
      await page.waitForLoadState("networkidle");

      // ⚠️ The URL must not move. The board owns `/` by BEING the page at
      // `/`; a redirect there is the shape #156 was about.
      expect(new URL(page.url()).pathname).toBe(`/${slug}`);
      await expect(page.getByTestId("dashboard-empty")).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("a fresh project's board is empty, with the way in on screen", async () => {
      // Nothing seeds, so this is the first impression rather than a corner
      // case. Asserted as the empty state plus the header's Add card button,
      // never as a card count that a seeder could satisfy. The dashed Add
      // tile that used to be the second half of this assertion was deleted
      // with feedback #P2168: an empty board says what a board is for, and
      // the way in is the one button in the header.
      await expect(page.getByTestId("dashboard-card")).toHaveCount(0);
      await expect(page.getByTestId("dashboard-add")).toBeVisible();
      await expect(page.getByTestId("dashboard-empty-docs")).toBeVisible();
    });

    await test.step("Activity is still there, one path down", async () => {
      await page.goto(`/${slug}/activity`);
      await page.waitForLoadState("networkidle");
      expect(new URL(page.url()).pathname).toBe(`/${slug}/activity`);
      await expect(page.getByTestId("dashboard-empty")).toHaveCount(0);
    });

    await test.step("a card added through the wizard is still there after a reload", async () => {
      await page.goto(`/${slug}`);
      await page.waitForLoadState("networkidle");
      await page.getByTestId("dashboard-add").click();
      await expect(page.getByTestId("dashboard-catalogue")).toBeVisible({
        timeout: 10_000,
      });

      await page
        .locator(
          '[data-testid="dashboard-catalogue-row"][data-metric="heldQuests"]',
        )
        .click();

      // ⚠️ Armed BEFORE the click, never asserted after it. Lore batches its
      // calls through `/api/_batch`, so an assertion that reads the DOM
      // afterwards passes before the save is even sent - a race of a few
      // milliseconds, which is what a green CI over a red local run on this
      // shape means.
      const saved = page.waitForResponse(
        (r) => r.url().includes("/api/") && r.request().method() === "POST",
        { timeout: 15_000 },
      );
      await page.getByTestId("dashboard-catalogue-save").click();
      expect((await saved).ok()).toBe(true);

      await expect(page.getByTestId("dashboard-card")).toHaveCount(1, {
        timeout: 15_000,
      });

      // ⚠️ Base UI leaves `pointer-events: none` on the body after a drawer
      // closes, so the next interaction can be swallowed. A reload is the
      // assertion this step wants anyway.
      await page.reload();
      await page.waitForLoadState("networkidle");

      const card = page.getByTestId("dashboard-card");
      await expect(card).toHaveCount(1, { timeout: 15_000 });
      await expect(card).toHaveAttribute("data-metric", "heldQuests");
      // With its NUMBER, not just its frame: a card that renders and never
      // resolves is the failure a count alone would miss.
      await expect(card.getByText("1", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
    });
  });

  /**
   * ⚠️ The common case, not the corner one. `project:update` is what curates
   * the board, and `ProjectRankPresets.CONTRIBUTOR` does not carry it - so
   * this is what most members see.
   */
  test("a member without project:update gets a board and no controls", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(150_000);

    const t = Date.now();
    await registerAndVerify(page, `pbowner${t}@example.com`, "GoodPassw0rd");
    const projectTitle = `PBR${t}`.slice(0, 20);
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const reader = await newUserContext(browser, baseURL!, "pbreader");
    try {
      await test.step("the owner fills the board and invites a reader", async () => {
        await page.goto(`/${slug}`);
        await page.waitForLoadState("networkidle");
        await page.getByTestId("dashboard-add").click();
        await page
          .locator(
            '[data-testid="dashboard-catalogue-row"][data-metric="heldQuests"]',
          )
          .click();
        const saved = page.waitForResponse(
          (r) => r.url().includes("/api/") && r.request().method() === "POST",
          { timeout: 15_000 },
        );
        await page.getByTestId("dashboard-catalogue-save").click();
        expect((await saved).ok()).toBe(true);
        await expect(page.getByTestId("dashboard-card")).toHaveCount(1, {
          timeout: 15_000,
        });

        await page.goto(`/${slug}/settings/members`);
        await page.waitForLoadState("domcontentloaded");
        await page.getByRole("button", { name: /^invite$/i }).click();
        await page.getByPlaceholder("user@example.com").fill(reader.email);
        const created = page.waitForResponse(
          (r) =>
            r.request().method() === "POST" &&
            r.url().endsWith("/api/invitations"),
          { timeout: 15_000 },
        );
        await page.getByRole("button", { name: /send invitation/i }).click();
        expect((await created).ok()).toBe(true);
      });

      await test.step("the reader joins and is put on the Contributor rank", async () => {
        await reader.page.goto("/account/invitations");
        await reader.page.waitForLoadState("domcontentloaded");
        const accepted = reader.page.waitForResponse(
          (r) =>
            r.request().method() === "POST" &&
            /\/api\/invitations\/[^/]+\/accept$/.test(r.url()),
          { timeout: 15_000 },
        );
        await reader.page.getByRole("button", { name: /^accept$/i }).click();
        expect((await accepted).ok()).toBe(true);

        // ⚠️ The rank is assigned through the module's REST route rather than
        // the members page's picker. Driving a Base UI select here would test
        // the picker, which `members.spec.ts` owns; what this spec is about
        // is what the BOARD does for somebody holding that rank. The preset
        // is seeded on create, so `contributor` names a real definition.
        // Both URLs come from the action registry rather than being written
        // out here: an `$action` path is no more typecheck-protected than a
        // `$page` name, so a hand-written one rots silently.
        const usersUrl = (await apiPath(page, "getProjectUsers")).replace(
          ":id",
          String(projectId),
        );
        const assignUrl = (await apiPath(page, "assignRank"))
          .replace(":type", "project")
          .replace(":scopeId", String(projectId));

        const assigned = await page.evaluate(
          async ({ usersUrl, assignUrl, email }) => {
            const users = (await fetch(usersUrl, {
              credentials: "include",
            }).then((r) => r.json())) as Array<{ id: string; email?: string }>;
            const found = users.find((it) => it.email === email);
            if (!found) return { ok: false, reason: "member not found" };
            const put = await fetch(assignUrl.replace(":userId", found.id), {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ key: "contributor" }),
            });
            return { ok: put.ok, reason: await put.text() };
          },
          { usersUrl, assignUrl, email: reader.email },
        );
        expect(assigned.ok, assigned.reason).toBe(true);
      });

      await test.step("the reader sees the board and none of the controls", async () => {
        await reader.page.goto(`/${slug}`);
        await reader.page.waitForLoadState("networkidle");

        // The card and its number are there: reading is `project:read`, the
        // floor every rank holds.
        await expect(reader.page.getByTestId("dashboard-card")).toHaveCount(1, {
          timeout: 15_000,
        });

        // ⚠️ ABSENT, not disabled. `toHaveCount(0)` and never
        // `toBeDisabled()`: a greyed kebab advertises a board this reader
        // cannot curate, which is exactly what the empty state says once
        // instead.
        await expect(reader.page.getByTestId("dashboard-add")).toHaveCount(0);
        await expect(
          reader.page.getByRole("button", { name: /card options/i }),
        ).toHaveCount(0);
        await expect(
          reader.page.locator(
            '[data-testid="dashboard-card"][draggable="true"]',
          ),
        ).toHaveCount(0);
      });
    } finally {
      await reader.ctx.close();
    }
  });

  /**
   * The two metrics whose scope is neither a project nor an app.
   *
   * ⚠️ **This is the shape that shipped broken.** `epicProgress` and
   * `releaseProgress` point at a single row of another table, so the Add-card
   * panel has to ask a question it asks nowhere else - and nothing exercised
   * it. The resolvers were specced to death in
   * `test/dashboard-resolve.spec.ts`, and the panel was specced on
   * `heldQuests`, whose scope a project board FORCES so the step never
   * renders. Both metrics therefore reached production with a scope step that
   * drew nothing and a Save button that could never enable, while every unit
   * spec stayed green.
   *
   * So the assertion is the whole path - catalogue, picker, save, resolved
   * value - and never the pieces.
   *
   * The epic figure is 50 on purpose. Zero is also what a card that renders
   * and never resolves shows, and 100 is what the wrong denominator gives
   * (`EpicProgressService` counts shelved INSIDE `total`, so the card
   * subtracts); only 50 can come from a real read done right.
   */
  test("adds an epic card and a release card, each scoped to one row", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `escope${t}@example.com`, "GoodPassw0rd");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `EP${t}`.slice(0, 20),
      { options: { work: ["epics", "releases"] } },
    );

    const post = async <T>(path: string, body: unknown): Promise<T> =>
      (await page.evaluate(
        async ({ path, body }) => {
          const r = await fetch(path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(body),
          });
          if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
          return r.json();
        },
        { path, body },
      )) as T;

    const epic = await post<{ id: number }>(`/api/createEpic/${projectId}`, {
      title: `Scoped${t}`,
    });
    const release = await post<{ id: number }>(
      `/api/createRelease/${projectId}`,
      { tag: "1.0.0" },
    );
    await post(`/api/updateEpic/${epic.id}`, { releaseId: release.id });

    const made: Array<{ id: number }> = [];
    for (const title of [`A${t}`, `B${t}`]) {
      made.push(
        await apiPost<{ id: number }>(page, "createQuest", {
          projectId,
          title,
          description: "seeded",
          area: "Main",
          priority: "medium",
          objectives: [],
          attachments: [],
        }),
      );
    }
    // ⚠️ Both attached while the epic is PLANNED, then it begins: the quest
    // set freezes at Begin, and a quest is acceptable only inside an active
    // epic. Reversing these two is the refusal "Begin it first".
    for (const quest of made) {
      await post(`/api/attachQuest/${epic.id}`, { questId: quest.id });
    }
    await post(`/api/setEpicStatus/${epic.id}`, { status: "active" });

    // One of the two done → 1/2.
    await page.evaluate(async (id) => {
      const r = await fetch(`/api/acceptQuest/${id}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`accept ${r.status}`);
    }, made[0].id);
    await post(`/api/completeQuest/${made[0].id}`, {});

    const addCard = async (metric: string, scopeTestId: string) => {
      await page.goto(`/${slug}`);
      await page.waitForLoadState("networkidle");
      await page.getByTestId("dashboard-add").click();
      await expect(page.getByTestId("dashboard-catalogue")).toBeVisible({
        timeout: 10_000,
      });
      await page
        .locator(
          `[data-testid="dashboard-catalogue-row"][data-metric="${metric}"]`,
        )
        .click();

      // The step that rendered nothing. Asserted as a visible, clickable row
      // before anything is clicked, because "Save stayed disabled" is the
      // symptom and an empty picker is the cause.
      const target = page.getByTestId(scopeTestId).first();
      await expect(target).toBeVisible({ timeout: 10_000 });
      await target.click();

      // ⚠️ Armed BEFORE the click. Lore batches through `/api/_batch`, so a
      // DOM assertion afterwards passes before the save is sent.
      const saved = page.waitForResponse(
        (r) => r.url().includes("/api/") && r.request().method() === "POST",
        { timeout: 15_000 },
      );
      await page.getByTestId("dashboard-catalogue-save").click();
      expect((await saved).ok()).toBe(true);
    };

    await test.step("an epic card is scoped to one epic and resolves", async () => {
      await addCard("epicProgress", "dashboard-scope-epic");

      // Reloaded rather than asserted in place: Base UI leaves
      // `pointer-events: none` on the body after a drawer closes.
      await page.reload();
      await page.waitForLoadState("networkidle");

      const card = page.locator('[data-metric="epicProgress"]');
      await expect(card).toHaveCount(1, { timeout: 15_000 });
      await expect(card).toContainText("50", { timeout: 15_000 });
    });

    await test.step("a release card is scoped to one release and resolves", async () => {
      await addCard("releaseProgress", "dashboard-scope-release");

      await page.reload();
      await page.waitForLoadState("networkidle");

      const card = page.locator('[data-metric="releaseProgress"]');
      await expect(card).toHaveCount(1, { timeout: 15_000 });
      // The release holds the epic, so it counts the same two quests. ⚠️ NO
      // subtraction on this side - `ReleaseContentService.progressOf` already
      // counts shelved outside `total` - and 50 is the same figure either
      // way here, which is why the epic card above is the one that pins it.
      await expect(card).toContainText("50", { timeout: 15_000 });
    });
  });
});
