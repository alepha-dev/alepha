import { expect, type Page, test } from "@playwright/test";
import {
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
  setProjectFeature,
} from "./_helpers.ts";

/**
 * The backlog gate, end to end.
 *
 * This is the behaviour the whole Epics feature exists for: a quest inside a
 * `planned` epic is specified but not released into the backlog, and it is
 * hidden by FILTERING reads rather than by mutating the quest. Unit tests pin
 * the SQL; this pins the thing a person actually sees.
 *
 * The last step is the one that matters most. Lore already had a way to hide a
 * quest — `shelvedAt`, meaning "decided out of scope" — and the entire premise
 * of Epics is that "not released yet" is a DIFFERENT fact that was previously
 * being expressed with that same word. So the test finishes by driving both
 * mechanisms at once and asserting they stay independent. If activating an
 * epic ever un-shelved a quest, or shelving one ever leaked it back into a
 * planned epic's hidden set, that is the regression that would make the
 * feature pointless, and only this assertion catches it.
 */
test.describe("Epics — the backlog gate", () => {
  test("a planned epic hides its quests, and shelving stays independent", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    page.on("response", async (res) => {
      if (res.url().includes("/api/") && !res.ok()) {
        const body = await res.text().catch(() => "<body unreadable>");
        console.log(
          `API ${res.status()} ${res.request().method()} ${res.url()}: ${body}`,
        );
      }
    });

    const t = Date.now();
    const email = `epic${t}@example.com`;
    const password = "GoodPassw0rd";

    await registerAndVerify(page, email, password);
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `Ep${t}`.slice(0, 20),
    );

    await setProjectFeature(page, projectId, "epics", true);

    const gatedTitle = `Gated${t}`;
    const releasedTitle = `Released${t}`;

    // Seed through the API rather than the UI: this test is about visibility
    // rules, and driving four creation dialogs would only add ways for it to
    // fail for reasons that are not the gate.
    const epic = await page.evaluate(
      async ({ projectId, title }) => {
        const r = await fetch(`/api/createEpic/${projectId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ title }),
        });
        if (!r.ok) throw new Error(`createEpic ${r.status} ${await r.text()}`);
        return r.json() as Promise<{
          id: number;
          number: number;
          status: string;
        }>;
      },
      { projectId, title: `Deploy${t}` },
    );
    expect(epic.status).toBe("planned");

    const questIds: number[] = [];
    for (const title of [gatedTitle, releasedTitle]) {
      const { id } = await apiPost<{ id: number }>(page, "createQuest", {
        projectId,
        title,
        description: "Seeded for the backlog gate",
        area: "orm",
        priority: "high",
        difficulty: 2,
        objectives: [],
        attachments: [],
      });
      questIds.push(id);
      await page.evaluate(
        async ({ epicId, questId }) => {
          const r = await fetch(`/api/attachQuest/${epicId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ questId }),
          });
          if (!r.ok)
            throw new Error(`attachQuest ${r.status} ${await r.text()}`);
        },
        { epicId: epic.id, questId: id },
      );
    }

    await test.step("a planned epic's quests are absent from the backlog", async () => {
      // The quest list is the project ROOT, not `/quests` — `/quests/:shortId`
      // is a single quest. An earlier draft of this test pointed at
      // `/<slug>/quests` and its "the quests are absent" assertion passed
      // vacuously against a page that does not exist.
      await page.goto(`/${slug}/`);
      await page.waitForLoadState("networkidle");

      await expect(page.getByText(gatedTitle)).toHaveCount(0);
      await expect(page.getByText(releasedTitle)).toHaveCount(0);

      // The sidebar's open-quest badge must agree with the list it links to.
      // This assertion exists because the first run of this test caught it
      // disagreeing: the badge counted both gated quests and read "2" beside
      // a visibly empty list. `countOpenQuests` already excludes shelved
      // quests for exactly this reason, and a planned epic is the same class
      // of hidden.
      //
      // Asserted against the count endpoint rather than the rendered badge:
      // the number is the contract, the badge is one rendering of it, and a
      // DOM-shape assertion here would fail for reasons that are not the gate.
      const openCount = await page.evaluate(async (projectId) => {
        const r = await fetch(`/api/projects/${projectId}/quests/count`, {
          credentials: "include",
        });
        if (!r.ok) throw new Error(`count ${r.status} ${await r.text()}`);
        return (await r.json()) as { count: number };
      }, projectId);
      expect(openCount.count).toBe(0);
    });

    await test.step("but the epic itself shows every one of them", async () => {
      // `?tab=quests` is load-bearing since the page moved onto
      // `DetailLayout`: the epic's quests live behind a tab now, and the
      // default landing tab is the description. Without it this step passes
      // or fails on whether Overview happens to mention a quest title.
      //
      // No `networkidle` here: the Flow tab embeds the dependency graph,
      // which polls every 60s, so the network is never idle and the wait can
      // only time out. The visibility assertions below carry their own
      // timeouts.
      await page.goto(`/${slug}/epics/${epic.number}?tab=quests`);

      await expect(page.getByText(gatedTitle).first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText(releasedTitle).first()).toBeVisible();
    });

    await test.step("beginning the epic releases them in one write", async () => {
      await page.evaluate(async (epicId) => {
        const r = await fetch(`/api/setEpicStatus/${epicId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ status: "active" }),
        });
        if (!r.ok)
          throw new Error(`setEpicStatus ${r.status} ${await r.text()}`);
      }, epic.id);

      // The quest list is the project ROOT, not `/quests` — `/quests/:shortId`
      // is a single quest. An earlier draft of this test pointed at
      // `/<slug>/quests` and its "the quests are absent" assertion passed
      // vacuously against a page that does not exist.
      await page.goto(`/${slug}/`);
      await page.waitForLoadState("networkidle");

      await expect(page.getByText(gatedTitle).first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText(releasedTitle).first()).toBeVisible();
    });

    await test.step("shelving hides one quest for the other reason, and only that one", async () => {
      // The two mechanisms must not interfere. `shelvedAt` means "decided out
      // of scope"; a planned epic means "not released yet". Both hide a quest
      // from the backlog, and neither may imply the other.
      // `shelveQuest` has no body schema, so it is GET at the canonical
      // /api/shelveQuest/:id — the same shape milestones.spec.ts drives for
      // `acceptQuest`.
      await page.evaluate(async (questId) => {
        const r = await fetch(`/api/shelveQuest/${questId}`, {
          method: "GET",
          credentials: "include",
        });
        if (!r.ok) throw new Error(`shelveQuest ${r.status} ${await r.text()}`);
      }, questIds[0]);

      // The quest list is the project ROOT, not `/quests` — `/quests/:shortId`
      // is a single quest. An earlier draft of this test pointed at
      // `/<slug>/quests` and its "the quests are absent" assertion passed
      // vacuously against a page that does not exist.
      await page.goto(`/${slug}/`);
      await page.waitForLoadState("networkidle");

      await expect(page.getByText(gatedTitle)).toHaveCount(0);
      await expect(page.getByText(releasedTitle).first()).toBeVisible();
    });

    await test.step("the epic still shows the shelved quest, because hidden is not unreachable", async () => {
      // Again `?tab=quests` — see the note in the step above.
      await page.goto(`/${slug}/epics/${epic.number}?tab=quests`);

      await expect(page.getByText(gatedTitle).first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText(releasedTitle).first()).toBeVisible();
    });
  });
});

/**
 * The Epics LIST, which the gate test above never visits — it goes straight
 * to `/epics/:number`. Since the list moved onto `AlephaTable` it owns its
 * own fetch (the route loader was removed), so "the page renders rows at
 * all" is now a client-side path with nothing server-rendered behind it to
 * mask a failure.
 *
 * The progress caption is asserted rather than the tick bar: the bar is
 * `aria-hidden` decoration, and the caption is the part that carries the
 * meaning — including "specified, none released", which is the list's only
 * statement of the backlog gate the test above proves.
 */
test.describe("Epics — the list", () => {
  test("renders, filters by search, and creates from the toolbar", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `epiclist${t}@example.com`, "GoodPassw0rd");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `El${t}`.slice(0, 20),
    );
    await setProjectFeature(page, projectId, "epics", true);

    const withQuest = `Alpha${t}`;
    const empty = `Beta${t}`;

    for (const title of [withQuest, empty]) {
      await page.evaluate(
        async ({ projectId, title }) => {
          const r = await fetch(`/api/createEpic/${projectId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ title }),
          });
          if (!r.ok)
            throw new Error(`createEpic ${r.status} ${await r.text()}`);
        },
        { projectId, title },
      );
    }

    // One quest on the first epic only, so the two rows must render two
    // different captions — an assertion a single-epic fixture cannot make.
    const epics = await page.evaluate(async (projectId) => {
      const r = await fetch(`/api/getEpics/${projectId}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`getEpics ${r.status} ${await r.text()}`);
      return (await r.json()) as { id: number; title: string }[];
    }, projectId);
    const target = epics.find((e) => e.title === withQuest);
    expect(target).toBeDefined();

    const { id: questId } = await apiPost<{ id: number }>(page, "createQuest", {
      projectId,
      title: `Q${t}`,
      description: "Seeded for the list",
      area: "orm",
      priority: "high",
      difficulty: 2,
      objectives: [],
      attachments: [],
    });
    await page.evaluate(
      async ({ epicId, questId }) => {
        const r = await fetch(`/api/attachQuest/${epicId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ questId }),
        });
        if (!r.ok) throw new Error(`attachQuest ${r.status} ${await r.text()}`);
      },
      { epicId: target!.id, questId },
    );

    await test.step("both epics render, each with its own progress caption", async () => {
      await page.goto(`/${slug}/epics`);

      await expect(page.getByRole("link", { name: withQuest })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByRole("link", { name: empty })).toBeVisible();

      // Freshly created epics are `planned`, so the one holding a quest
      // reports it as specified-not-released and the other as having none.
      await expect(page.getByText("1 specified, none released")).toBeVisible();
      await expect(page.getByText("No quests yet")).toBeVisible();
    });

    await test.step("the sidebar badges the planned epics", async () => {
      // Both seeded epics are `planned`, and the badge counts exactly that.
      // It matters because `countOpenQuests` runs the backlog gate: the quest
      // attached above is inside a planned epic, so it is absent from the
      // Quests badge on purpose. This number is the sidebar's only trace of
      // it. Read off the nav link so a stray "2" elsewhere cannot satisfy it.
      await expect(epicsBadge(page)).toHaveText("2", { timeout: 15_000 });
    });

    await test.step("the toolbar search narrows the table", async () => {
      await page.getByRole("textbox", { name: "Search" }).fill(withQuest);

      await expect(page.getByRole("link", { name: empty })).toHaveCount(0, {
        timeout: 15_000,
      });
      await expect(page.getByRole("link", { name: withQuest })).toBeVisible();

      await page.getByRole("button", { name: "Reset filters" }).click();
      await expect(page.getByRole("link", { name: empty })).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("the [[ picker works in an epic description", async () => {
      // The capability this whole `LoreEditor` unification was for. The
      // picker used to be wired by exactly ONE caller — the folio body — so
      // `[[` autocomplete existed on one screen while the syntax it inserts
      // resolved on three. Asserted on an EPIC because that is the surface
      // that had neither the picker nor the rewrite before.
      await page.getByRole("link", { name: withQuest }).click();
      await page.getByRole("button", { name: /^Edit$/ }).click();

      const modal = page.getByRole("dialog");
      await expect(modal).toBeVisible();
      const editor = modal.locator(".cm-content");
      await expect(editor).toBeVisible({ timeout: 15_000 });
      await editor.click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.type("[[Q");

      // CodeMirror renders completions as `option`-role entries. The quest
      // seeded above proves the picker is reading the same project-wide
      // lookups the folio one does.
      const option = page.getByRole("option", { name: `Q${t}` }).first();
      await expect(option).toBeVisible({ timeout: 15_000 });
      await option.click();
      await expect(editor).toContainText("[[quest#", { timeout: 10_000 });

      // This step navigated to the epic's own page; the steps after it act
      // on the LIST's toolbar, which does not exist here.
      await page.goto(`/${slug}/epics`);
      await expect(page.getByRole("link", { name: withQuest })).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("the Epics breadcrumb climbs back to the list", async () => {
      // A section crumb is a link only when `SECTION_HREF_ROUTES` in
      // `ProjectView` maps the open route to a list route. That map was a
      // folio-only ternary, so on an epic the "Epics" crumb fell through to
      // `href: undefined` and `AppShell` rendered it as a `BreadcrumbPage`:
      // plain text, with no way back to the list from the header.
      await page.getByRole("link", { name: withQuest }).click();
      await expect(page).toHaveURL(/\/epics\/\d+$/);

      const crumb = page
        .getByRole("navigation", { name: "breadcrumb" })
        .getByRole("link", { name: "Epics" });
      // Assert the anchor, not just visibility: `BreadcrumbPage` also carries
      // `role="link"`, so a dead crumb still matches the locator and the only
      // thing separating the two is a real `href`. Without this the test only
      // failed on the click, 120s later, via `element is not enabled`.
      await expect(crumb).toHaveAttribute("href", `/${slug}/epics`, {
        timeout: 15_000,
      });
      await crumb.click();

      await expect(page).toHaveURL(new RegExp(`/${slug}/epics$`));
      await expect(page.getByRole("link", { name: empty })).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("the toolbar create button adds a row without a reload", async () => {
      // The `+` action and the dialog's submit share the "Create Epic" label,
      // so the toolbar one is addressed through the table's own toolbar and
      // the submit through the dialog.
      const created = `Gamma${t}`;
      await page.getByRole("button", { name: "Create Epic" }).first().click();

      const modal = page.getByRole("dialog");
      await expect(modal).toBeVisible();
      await modal.getByRole("textbox").first().fill(created);
      await modal.getByRole("button", { name: "Create Epic" }).click();

      // No `page.goto` here on purpose: the row may only appear because the
      // create bumped the table's `refreshSignal`, which is the wiring this
      // step exists to pin.
      await expect(page.getByRole("link", { name: created })).toBeVisible({
        timeout: 15_000,
      });

      // And the sidebar badge follows, without a reload. A new epic is born
      // `planned`, so the count has to move 2 -> 3: the table's own refresh
      // lands back in `fetchEpics`, which recounts and pushes the atom.
      await expect(epicsBadge(page)).toHaveText("3", { timeout: 15_000 });
    });

    await test.step("releasing an epic takes it back off the badge", async () => {
      // The direction the list alone can never cover: status changes on the
      // DETAIL page, which knows one epic and so applies a delta instead of
      // a count. Releasing is also the main way this badge goes down.
      await page.getByRole("link", { name: empty }).click();
      await page.getByRole("button", { name: "Begin the Epic" }).click();

      await expect(epicsBadge(page)).toHaveText("2", { timeout: 15_000 });
    });
  });
});

/**
 * The Epics entry's count in the sidebar.
 *
 * Scoped to `[data-slot="sidebar"]` because the BREADCRUMB is also a
 * `navigation` landmark carrying an "Epics" link: a bare role lookup
 * resolves to that one instead and reads "Epics" with no number at all.
 */
const epicsBadge = (page: Page) =>
  page
    .locator('[data-slot="sidebar"]')
    .locator('[data-slot="sidebar-menu-item"]', { hasText: "Epics" })
    .locator('[data-slot="sidebar-menu-badge"]');
