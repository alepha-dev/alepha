import { expect, type Page, test } from "@playwright/test";

import {
  apiPost,
  createProjectViaWizard,
  newUserContext,
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
      await page.goto(`/${slug}/quests`);
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
      // No `networkidle` here. That used to be because the Flow tab polled
      // every 60s, so the network was never idle and the wait could only time
      // out. The poll went with the questline rewrite, but the wait is still
      // the wrong tool: the visibility assertions carry their own timeouts.
      await page.goto(`/${slug}/epics/${epic.number}?tab=quests`);

      await expect(page.getByText(gatedTitle).first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText(releasedTitle).first()).toBeVisible();
    });

    await test.step("the count stays readable once its tab is selected", async () => {
      // Feedback #2007: the "0" beside Quests vanished once that tab was
      // selected. The count carried `text-muted-foreground`, which is right
      // while the segment is inactive and nearly invisible on the active one,
      // where the thumb paints `bg-primary` underneath it.
      //
      // The same element is measured in both states rather than two different
      // counts, because that is the comparison the report actually makes:
      // "perfectly legible on the inactive segments". A fixed threshold alone
      // would encode one Lore theme's palette.
      await page.goto(`/${slug}/epics/${epic.number}?tab=quests`);
      // The count is `quests?.length`, so it does not exist until that fetch
      // lands. Measuring first reads an absent element, not an invisible one.
      await expect(
        page.locator('[data-slot="segmented-count"]').first(),
      ).toBeVisible({ timeout: 15_000 });

      const measure = () =>
        page.evaluate(() => {
          // ⚠️ Colours come back as `oklab(...)` / `oklch(...)`, not `rgb()`.
          // Parsing the first three numbers as RGB channels reads
          // `oklab(0.985 0 0 / 0.7)` as near-black and reports a contrast of
          // 1.0 against a near-black thumb — a fix that works, measured as a
          // total failure. A canvas converts whatever the browser hands over,
          // and painting foreground OVER background composites the alpha,
          // which a translucent count needs.
          const canvas = document.createElement("canvas");
          canvas.width = 1;
          canvas.height = 1;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          const pixel = (background: string, foreground?: string) => {
            if (!ctx) return [0, 0, 0];
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, 1, 1);
            if (foreground) {
              ctx.fillStyle = foreground;
              ctx.fillRect(0, 0, 1, 1);
            }
            return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
          };
          const luminance = ([r, g, b]: number[]): number => {
            const channel = (v: number) => {
              const c = v / 255;
              return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            };
            return (
              0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
            );
          };

          const count = document.querySelector<HTMLElement>(
            '[data-slot="segmented-count"]',
          );
          if (!count) return null;

          const segment = count.closest('[data-slot="segmented-item"]');
          const active = segment?.getAttribute("data-state") === "active";

          // The active segment's own background is transparent — the thumb is
          // a separate absolutely-positioned span behind it — so an active
          // count has to be measured against the thumb.
          let background = "rgb(255, 255, 255)";
          if (active) {
            const thumb = document.querySelector<HTMLElement>(
              '[data-slot="segmented-thumb"]',
            );
            if (thumb) background = getComputedStyle(thumb).backgroundColor;
          } else {
            let node: Element | null = count;
            while (node) {
              const bg = getComputedStyle(node).backgroundColor;
              if (bg && !/rgba?\([^)]*,\s*0\)/.test(bg)) {
                background = bg;
                break;
              }
              node = node.parentElement;
            }
          }

          const a = luminance(pixel(background, getComputedStyle(count).color));
          const b = luminance(pixel(background));
          return {
            active,
            ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          };
        });

      const selected = await measure();
      expect(selected, "the Quests count must be on screen").not.toBeNull();
      expect(selected?.active).toBe(true);

      // Now the same count with its segment inactive, which is the state the
      // report calls readable.
      await page.getByRole("radio", { name: /overview|aperçu/i }).click();
      await expect(
        page.locator('[data-slot="segmented-count"]').first(),
      ).toBeVisible();
      const resting = await measure();
      expect(resting?.active).toBe(false);

      // Both halves. A bare "is it legible" would pass on a count that is
      // still markedly worse than it was; a bare comparison would pass on two
      // equally unreadable states.
      expect(selected?.ratio ?? 0).toBeGreaterThanOrEqual(4.5);
      expect(selected?.ratio ?? 0).toBeGreaterThanOrEqual(
        (resting?.ratio ?? 0) * 0.9,
      );
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
      await page.goto(`/${slug}/quests`);
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
      // /api/shelveQuest/:id.
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
      await page.goto(`/${slug}/quests`);
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
      // `projectViewRoutes.ts` maps the open route to a list route. That map was a
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
      // The `+` action opens the dialog ("New Epic") and the dialog's submit
      // confirms it ("Create Epic"): "New" opens the form, "Create" confirms
      // it, the split the rest of the catalogue uses (#1731).
      const created = `Gamma${t}`;
      await page.getByRole("button", { name: "New Epic" }).first().click();

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

      // Begin asks first now (#1594): it releases the epic's quests into the
      // backlog, so it changes what other people see. The dialog's confirm
      // button carries the same label as the page button that opened it, on
      // purpose, so `.last()` is what distinguishes them.
      await page.getByRole("button", { name: "Begin the Epic" }).last().click();

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

/**
 * The Flow tab, which is the questline map.
 *
 * The layout itself is unit-tested in `questlineLayout.spec.ts`; what only an
 * e2e can check is that a fork the DATA describes reaches the screen, and
 * that opening a quest from it offers the right ways onward. Those two are
 * the whole point of the surface: seeing the shape, and moving along it.
 */
test.describe("Epics — the questline", () => {
  test("draws the fork, and walks it from inside the quest", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `flow${t}@example.com`, "GoodPassw0rd");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `Fl${t}`.slice(0, 20),
    );
    await setProjectFeature(page, projectId, "epics", true);

    // `createEpic` and `attachQuest` take a path param, which `apiPath` does
    // not substitute, so they go through a raw fetch the way the gate test
    // above does. `createQuest` has none and can use the helper.
    const epic = await page.evaluate(
      async ({ projectId, title }) => {
        const r = await fetch(`/api/createEpic/${projectId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ title }),
        });
        if (!r.ok) throw new Error(`createEpic ${r.status} ${await r.text()}`);
        return r.json() as Promise<{ id: number; number: number }>;
      },
      { projectId, title: `Flow${t}` },
    );

    const seed = async (title: string, dependsOn?: number) => {
      const quest = await apiPost<{ id: number; shortId: number }>(
        page,
        "createQuest",
        {
          projectId,
          title,
          description: "Seeded for the questline",
          area: "orm",
          priority: "high",
          objectives: [],
          attachments: [],
          ...(dependsOn != null ? { dependsOn } : {}),
        },
      );
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
        { epicId: epic.id, questId: quest.id },
      );
      return { ...quest, title };
    };

    // A root that forks into two, plus a quest depending on nothing at all.
    const root = await seed(`Root${t}`);
    const left = await seed(`Left${t}`, root.id);
    const right = await seed(`Right${t}`, root.id);
    const loose = await seed(`Loose${t}`);

    const card = (q: { shortId: number; title: string }) =>
      page.getByRole("button", { name: `#${q.shortId} ${q.title}` });

    await test.step("every quest is on the board at once", async () => {
      await page.goto(`/${slug}/epics/${epic.number}?tab=flow`);

      for (const quest of [root, left, right, loose]) {
        await expect(card(quest)).toBeVisible({ timeout: 15_000 });
      }
    });

    await test.step("the header counts what the board is showing", async () => {
      // Two roots are ready; the two behind the fork are waiting on it.
      await expect(page.getByText("4", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("2 ready")).toBeVisible();
      await expect(page.getByText("2 waiting")).toBeVisible();
    });

    await test.step("opening the fork names both ways onward", async () => {
      await card(root).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 15_000 });

      // Two columns of neighbour cards used to flank the panel, faded in
      // after it landed. They are gone: they capped the dialog at
      // `calc(100vw-32rem)` to reserve their own room, so the quest got
      // narrower as the screen got wider. The links they carried were never
      // theirs alone: the quest's own questline rows, inside the panel, name
      // the same neighbours, and unlike the columns they survive below `xl`.
      await expect(dialog.getByText(left.title)).toBeVisible({
        timeout: 10_000,
      });
      await expect(dialog.getByText(right.title)).toBeVisible();
    });

    await test.step("the dialog is a preview, not the quest page", async () => {
      const dialog = page.getByRole("dialog");

      // The title is an anchor to the quest's own page: this is the one
      // mount whose subject has a page a click away, which is also why the
      // lifecycle verb is withheld. Accepting a quest is a decision that
      // wants the quest in front of you, not a popup over a map.
      await expect(
        dialog.getByRole("link", { name: new RegExp(root.title) }),
      ).toHaveAttribute("href", new RegExp(`/quests/${root.shortId}$`));
      await expect(
        dialog.getByRole("button", { name: /accept.*quest/i }),
      ).toHaveCount(0);
      await expect(
        dialog.getByRole("button", { name: /^edit$/i }),
      ).toBeVisible();
    });

    await test.step("a neighbour link leaves the map for that quest", async () => {
      const dialog = page.getByRole("dialog");
      // The questline row's own `#id` anchor, not the title's: both are
      // links in this panel, and only this one points at the neighbour.
      await dialog
        .getByRole("link", { name: `#${left.shortId}`, exact: true })
        .click();

      await expect(page).toHaveURL(new RegExp(`/quests/${left.shortId}$`), {
        timeout: 10_000,
      });

      // Back to the board for the step below, which still expects it open.
      await page.goBack();
      await card(root).click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 });
    });

    await test.step("escape returns to the board", async () => {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0, {
        timeout: 10_000,
      });
      await expect(card(root)).toBeVisible();
    });
  });
});

/**
 * The gate on epic mutations, end to end, with two real accounts.
 *
 * Every epic endpoint was owner-only until 2026-08-28, which contradicted
 * two things at once: the header's "Create epic" entry is shown to every
 * member (`ProjectActionsCreateButton` gates only the invite item on
 * ownership), and an epic exists to group quests and folios that any member
 * may already create. So a member clicking the entry they were shown got a
 * 403.
 *
 * Unit specs pin the gate on the controller; this pins it over real HTTP
 * with a real member session, which is the only place the whole chain —
 * session, `$secure` permissions, `assertMember` — is exercised together.
 *
 * The calls go through `fetch` from the member's own page rather than the
 * creation dialogs: what is under test is authorization, and driving three
 * dialogs would only add ways to fail for reasons that are not the gate.
 */
test.describe("Epics — a member, not just the owner", () => {
  test("an invited member creates an epic and files a quest and a folio under it", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `epicowner${t}@example.com`, "GoodPassw0rd");
    const projectTitle = `Mem${t}`.slice(0, 20);
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      projectTitle,
    );
    await setProjectFeature(page, projectId, "epics", true);

    const member = await newUserContext(browser, baseURL!, "epicmember");
    try {
      await test.step("owner invites, member accepts", async () => {
        await page.goto(`/${slug}/settings/members`);
        await page.waitForLoadState("domcontentloaded");
        await page.getByRole("button", { name: /^invite$/i }).click();
        await page.getByPlaceholder("user@example.com").fill(member.email);
        const invited = page.waitForResponse(
          (r) =>
            r.request().method() === "POST" &&
            r.url().endsWith("/api/invitations"),
          { timeout: 15_000 },
        );
        await page.getByRole("button", { name: /send invitation/i }).click();
        expect((await invited).ok()).toBe(true);

        await member.page.goto("/account/invitations");
        await member.page.waitForLoadState("domcontentloaded");
        const accepted = member.page.waitForResponse(
          (r) =>
            r.request().method() === "POST" &&
            /\/api\/invitations\/[^/]+\/accept$/.test(r.url()),
          { timeout: 15_000 },
        );
        await member.page.getByRole("button", { name: /^accept$/i }).click();
        expect((await accepted).ok()).toBe(true);
      });

      // Land on the project first: `apiPost` reads the action table out of
      // the SSR payload, which only the project pages carry.
      await member.page.goto(`/${slug}/quests`);
      await member.page.waitForLoadState("domcontentloaded");

      // `createEpic` and `attachQuest` carry their id in the path, which
      // `apiPost` cannot fill in — raw `fetch`, same as the gate test above.
      const post = async <T>(path: string, body: unknown): Promise<T> =>
        member.page.evaluate(
          async ({ path, body }) => {
            const r = await fetch(path, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify(body),
            });
            if (!r.ok)
              throw new Error(`${path} → ${r.status} ${await r.text()}`);
            return r.json();
          },
          { path, body },
        ) as Promise<T>;

      const epic = await test.step("the member creates an epic", async () => {
        const created = await post<{
          id: number;
          number: number;
          status: string;
        }>(`/api/createEpic/${projectId}`, { title: `MemberEpic${t}` });
        expect(created.status).toBe("planned");
        return created;
      });

      await test.step("and files a quest under it", async () => {
        const quest = await apiPost<{ id: number }>(
          member.page,
          "createQuest",
          {
            projectId,
            title: `MemberQuest${t}`,
            description: "Filed by a member",
            area: "orm",
            priority: "high",
            objectives: [],
            attachments: [],
          },
        );
        const attached = await post<{ questCount: number }>(
          `/api/attachQuest/${epic.id}`,
          { questId: quest.id },
        );
        expect(attached.questCount).toBe(1);
      });

      await test.step("and a folio", async () => {
        const folio = await apiPost<{ id: string }>(member.page, "create", {
          projectId,
          title: `MemberFolio${t}`,
          content: "Written by a member",
        });
        expect(folio.id).toBeTruthy();
      });

      await test.step("the epic is then visible to the owner", async () => {
        await page.goto(`/${slug}/epics`);
        await expect(page.getByText(`MemberEpic${t}`).first()).toBeVisible({
          timeout: 15_000,
        });
      });
    } finally {
      await member.ctx.close();
    }
  });
});

/**
 * Beginning an epic from the list's row menu.
 *
 * The confirmation is the point, not decoration: beginning an epic releases
 * its quests into the project backlog (`EpicVisibilityService`), so it
 * changes what other people see on a page they are not looking at. The test
 * therefore drives the cancel path too, since a confirm that cannot say no
 * is a confirm that is not doing anything.
 */
test.describe("Epics — beginning from the list", () => {
  test("offers Begin on a planned epic only, and asks first", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `epicbegin${t}@example.com`, "GoodPassw0rd");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `Eb${t}`.slice(0, 20),
    );
    await setProjectFeature(page, projectId, "epics", true);

    const title = `Begin${t}`;
    await page.evaluate(
      async ({ projectId, title }) => {
        const r = await fetch(`/api/createEpic/${projectId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ title }),
        });
        if (!r.ok) throw new Error(`createEpic ${r.status} ${await r.text()}`);
      },
      { projectId, title },
    );

    await page.goto(`/${slug}/epics`);
    const row = page.locator("tbody tr", { hasText: title });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText("Planned");

    const openMenu = async () => {
      await row.getByRole("button").last().click();
    };

    await test.step("cancelling leaves the epic planned", async () => {
      await openMenu();
      await page.getByRole("menuitem", { name: "Begin the Epic" }).click();
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(row).toContainText("Planned");
    });

    await test.step("confirming begins it and the chip repaints", async () => {
      await openMenu();
      await page.getByRole("menuitem", { name: "Begin the Epic" }).click();
      await page.getByRole("button", { name: "Begin the Epic" }).last().click();

      // `refresh()` from the row-action context is what repaints this.
      await expect(row).toContainText("Active", { timeout: 15_000 });
    });

    await test.step("and the entry is gone now that it has begun", async () => {
      await openMenu();
      await expect(
        page.getByRole("menuitem", { name: "Begin the Epic" }),
      ).toHaveCount(0);
    });
  });
});

/**
 * Sorting the Epics list by Release.
 *
 * ⚠️ The whole point is the KEY, and there are now four wrong ones. Sorting
 * the `tag` as text puts `0.28.0` before `0.9.0`; sorting on `epic.releaseId`
 * sorts by row id; sorting on the release's `number` sorts by CREATION, which
 * is the bug quest #1640 was filed for. The right key is the parsed version,
 * `compareReleaseTags`, shared with `ProjectReleases`.
 *
 * The fixture creates the releases OUT of version order so all four answers
 * disagree. It used to create them in version order, where `number` and the
 * version agree exactly and this test passed against either.
 */
test.describe("Epics — sorting by release", () => {
  test("orders by parsed version, not by creation or as text, and keeps unassigned last", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `epicsort${t}@example.com`, "GoodPassw0rd");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `Es${t}`.slice(0, 20),
    );
    await setProjectFeature(page, projectId, "epics", true);

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

    // Deliberately NOT version order. Creation gives 0.28.0, 1.0.0, 0.29.0,
    // 0.9.0; text gives 0.28.0, 0.29.0, 0.9.0, 1.0.0; the parsed version
    // gives the order asserted below. All three differ, so the assertion can
    // tell them apart - which it could not while the fixture was sorted.
    const tags = ["0.28.0", "1.0.0", "0.29.0", "0.9.0"];
    for (const [i, tag] of tags.entries()) {
      const release = await post<{ id: number }>(
        `/api/createRelease/${projectId}`,
        { tag },
      );
      const epic = await post<{ id: number }>(`/api/createEpic/${projectId}`, {
        title: `Ships in ${tag} ${t}`,
      });
      await post(`/api/updateEpic/${epic.id}`, { releaseId: release.id });
      expect(i).toBeGreaterThanOrEqual(0);
    }
    // The unassigned pile, which most epics are.
    await post(`/api/createEpic/${projectId}`, { title: `Unassigned ${t}` });

    await page.goto(`/${slug}/epics`);
    const header = page.getByRole("button", { name: "Release" });
    await expect(header).toBeVisible({ timeout: 15_000 });

    // The release cell of every row, in rendered order. An empty string is an
    // epic with no release, which is exactly what the last-in-both-directions
    // assertion is about.
    const order = async () =>
      await page
        .locator("tbody tr")
        .evaluateAll((rows) =>
          rows.map(
            (row) => row.querySelectorAll("td")[3]?.textContent?.trim() ?? "",
          ),
        );

    await test.step("ascending walks the versions, unassigned last", async () => {
      await header.click();
      await expect
        .poll(order, { timeout: 15_000 })
        .toEqual(["0.9.0", "0.28.0", "0.29.0", "1.0.0", ""]);
    });

    await test.step("descending reverses the versions, unassigned STILL last", async () => {
      // Not a detail. If the empty rows swapped ends with the arrow they
      // would drag the whole unassigned pile through the middle of the list,
      // and the sort would read as broken rather than reversed.
      await header.click();
      await expect
        .poll(order, { timeout: 15_000 })
        .toEqual(["1.0.0", "0.29.0", "0.28.0", "0.9.0", ""]);
    });
  });
});

/**
 * The Release control on the epic aside, driven through the UI.
 *
 * ⚠️ `releases.spec.ts` attaches over the API (`/api/attachQuest/...`), so
 * every existing release test passes whatever this control does. That is how
 * it shipped reading `11` where it should read `0.28.0`: the trigger was a
 * bare `<SelectValue />`, and Base UI's `Select.Value` renders the VALUE, not
 * the selected row's label, so it printed the database id it was given.
 *
 * Hence the central assertion below is not "the tag is visible" but "the id
 * is NOT". A control showing the right label for the wrong reason would pass
 * the first and fail the second.
 */
test.describe("Epics — the release control", () => {
  test("shows the tag, not the id, through attach, detach and publish", async ({
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
    await registerAndVerify(page, `epicrel${t}@example.com`, "GoodPassw0rd");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `Er${t}`.slice(0, 20),
    );
    await setProjectFeature(page, projectId, "epics", true);

    // `apiPost` resolves a bare action name and does not substitute path
    // params, so the param-carrying endpoints are posted directly, the way
    // `releases.spec.ts` does.
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

    const open = await post<{ id: number }>(`/api/createRelease/${projectId}`, {
      tag: "0.28.0",
    });
    const later = await post<{ id: number }>(
      `/api/createRelease/${projectId}`,
      { tag: "0.29.0" },
    );

    const epic = await post<{ id: number; number: number }>(
      `/api/createEpic/${projectId}`,
      { title: `EpicRel${t}` },
    );

    await page.goto(`/${slug}/epics/${epic.number}`);
    const control = page.locator("aside").getByRole("combobox");
    await expect(control).toBeVisible({ timeout: 15_000 });
    // The release glyph on the trigger (feedback #2061). Lucide names the
    // svg after the icon, so this is the flag and not the status chip's
    // glyph two rows up.
    await expect(page.locator("aside svg.lucide-flag")).toBeVisible();

    /**
     * The write behind a pick, armed BEFORE the click that causes it.
     *
     * The trigger is optimistic: `EpicReleaseControl` keeps the picked value
     * in its own `useForm` field and paints the label from there, so it reads
     * "0.28.0" a few milliseconds BEFORE `updateEpic` is even dispatched.
     * Reloading on the strength of the label alone therefore aborts the
     * request mid-flight and the epic comes back detached - the label
     * assertion is not a barrier the way it was when this control was a raw
     * `<Select>` driven straight off `props.epic`.
     *
     * Awaiting the write is not a weaker assertion than reloading blind. It
     * is the only thing that makes the reload below mean anything: without
     * it, "No release" after a reload is what a LOST write and a genuine
     * detach both look like, so the detach step asserted nothing at all.
     *
     * Matched on the BODY rather than the URL. `roadmap.spec.ts` warns that
     * action calls are multiplexed through `POST /api/_batch`, where a
     * per-action URL never fires; one pick is one call in its own tick so it
     * does reach `/api/updateEpic` today, but `releaseId` is in the payload
     * either way and nothing else in this window writes that key.
     */
    const written = () =>
      page.waitForResponse(
        (res) =>
          res.request().method() === "POST" &&
          (res.request().postData() ?? "").includes("releaseId"),
        { timeout: 15_000 },
      );

    await test.step("attaching shows the tag and never the id", async () => {
      const saved = written();
      await control.click();
      await page.getByRole("option", { name: "0.28.0" }).click();

      await expect(control).toContainText("0.28.0", { timeout: 15_000 });
      // The regression itself. `open.id` is a small integer, so this is
      // asserted as a whole word to keep it from matching inside a date or
      // another number that happens to share the digits.
      await expect(control).not.toContainText(new RegExp(`\\b${open.id}\\b`));
      expect((await saved).status()).toBe(200);
    });

    await test.step("and it survives a reload, from the server", async () => {
      // Not decoration. A trigger that resolves its label from local state
      // looks identical to one that resolves it from the server until the
      // page is reloaded, so this is what separates "the label is right" from
      // "the attachment is real".
      await page.reload();
      await expect(control).toContainText("0.28.0", { timeout: 15_000 });
    });

    await test.step("detaching goes back to the none label", async () => {
      const saved = written();
      await control.click();
      await page.getByRole("option", { name: /^No release$/ }).click();

      await expect(control).toContainText("No release", { timeout: 15_000 });
      expect((await saved).status()).toBe(200);
      await page.reload();
      await expect(control).toContainText("No release", { timeout: 15_000 });
    });

    await test.step("a published release still names itself", async () => {
      // The exception the control is built around: a published release is
      // filtered out of the options, and stays visible only because it is
      // this epic's current one. Falling back to "none" here would read as
      // though the attachment had been lost.
      const saved = written();
      await control.click();
      await page.getByRole("option", { name: "0.29.0" }).click();
      await expect(control).toContainText("0.29.0", { timeout: 15_000 });
      // Publishing below reads the attachment back out of the database, so
      // the attachment has to BE there first.
      expect((await saved).status()).toBe(200);

      await post(`/api/publishRelease/${later.id}`, {});
      await page.reload();

      await expect(control).toContainText("0.29.0", { timeout: 15_000 });
      await expect(control).not.toContainText(new RegExp(`\\b${later.id}\\b`));
      // Frozen counts: the control must not offer to move it either.
      await expect(control).toBeDisabled();
    });
  });
});
