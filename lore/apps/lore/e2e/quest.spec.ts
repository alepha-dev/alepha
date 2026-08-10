import { expect, test } from "@playwright/test";
import {
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
  setProjectFeature,
} from "./_helpers.ts";

/**
 * Quest feature e2e: seeded via API to keep the setup cheap, then driven
 * through the real shadcn UI for open → accept → complete. Creating an area
 * from the Area combobox has its own test at the bottom of this file.
 *
 * Per the Lore CLAUDE.md convention, each big feature owns its own spec file.
 * Project create + auth are covered by the helpers — kept here as setup,
 * not as the focus of the test.
 */
test.describe("Quest", () => {
  test("accept → complete from quest view", async ({ page }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `quest${t}@example.com`;
    const password = "QuestTest123!";
    const projectTitle = `QC${t}`.slice(0, 20);
    const questTitle = `Quest${t}`;

    await registerAndVerify(page, email, password);
    const projectId = await createProjectViaWizard(page, projectTitle);

    const { id: questId, shortId } = await apiPost<{
      id: number;
      shortId: number;
    }>(page, "createQuest", {
      projectId,
      title: questTitle,
      description: "Seeded quest for e2e",
      area: "Main",
      priority: "medium",
      difficulty: 3,
      estimateMinutes: 30,
      objectives: [],
      attachments: [],
    });
    expect(questId).toBeGreaterThan(0);
    expect(shortId).toBeGreaterThan(0);

    await test.step("open quest view", async () => {
      await page.goto(`/p/${projectId}/q/${shortId}`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(questTitle).first()).toBeVisible({
        timeout: 10_000,
      });
      // The optional time estimate (30m) renders as a glanceable `~30m`
      // badge in the quest view header.
      await expect(page.getByText(/~30m/).first()).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("accept quest", async () => {
      const accept = page.getByRole("button", {
        name: /sign and accept|accept.*quest/i,
      });
      await expect(accept).toBeVisible({ timeout: 10_000 });
      await accept.click();
      // Once accepted, the Complete button is unlocked.
      await expect(
        page.getByRole("button", { name: /complete.*quest/i }),
      ).toBeVisible({ timeout: 10_000 });
    });

    await test.step("complete quest", async () => {
      // Toolbar's "Complete Quest" now opens a summary dialog; the dialog has
      // its own "Complete without summary" / "Complete with summary" buttons.
      // Pick the no-summary path for the golden flow.
      await page
        .getByRole("button", { name: /^complete quest$/i })
        .first()
        .click();
      await page
        .getByRole("button", { name: /complete without summary/i })
        .click();
      // Either stays on the quest view with a completed indicator or animates
      // back to the board — both leave us inside the project URL space.
      await page.waitForLoadState("networkidle");
      expect(page.url()).toContain(`/p/${projectId}`);
    });
  });

  /**
   * Reminder configuration UI (Lore quest #42). Drives the Quest Settings
   * accordion block: enable a preset cadence, verify the active state +
   * "next email" status, then disable. The reminder send itself runs on a
   * 5-minute cron — that's covered by unit tests in `quest-reminder.spec.ts`;
   * this test focuses on the UI contract.
   */
  test("configure + disable a reminder from Quest Settings", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `reminder${t}@example.com`;
    const password = "ReminderTest123!";
    const projectTitle = `RC${t}`.slice(0, 20);
    const questTitle = `Reminder${t}`;

    await registerAndVerify(page, email, password);
    const projectId = await createProjectViaWizard(page, projectTitle);

    // Reminders are an owner toggle, off by default — enable it before
    // exercising the reminder UI.
    await setProjectFeature(page, projectId, "questReminder");

    const { shortId } = await apiPost<{
      id: number;
      shortId: number;
    }>(page, "createQuest", {
      projectId,
      title: questTitle,
      description: "Seeded quest for reminder e2e",
      area: "Main",
      priority: "low",
      difficulty: 2,
      objectives: [],
      attachments: [],
    });

    await page.goto(`/p/${projectId}/q/${shortId}`);
    await page.waitForLoadState("networkidle");

    await test.step("accept quest (reminder is gated on accepted state)", async () => {
      const accept = page.getByRole("button", {
        name: /sign and accept|accept.*quest/i,
      });
      await expect(accept).toBeVisible({ timeout: 10_000 });
      await accept.click();
      await expect(
        page.getByRole("button", { name: /complete.*quest/i }),
      ).toBeVisible({ timeout: 10_000 });
    });

    await test.step("expand the Settings block", async () => {
      // Settings is the only collapsible block that defaults to closed.
      // Target via data-testid — the sidebar also has a "Settings" link
      // and accessible-name matching is ambiguous.
      await page.getByTestId("quest-collapsible-settings").click();
      await expect(page.getByRole("radio", { name: /^daily$/i })).toBeVisible({
        timeout: 5_000,
      });
    });

    await test.step("enable Daily cadence", async () => {
      await page.getByRole("radio", { name: /^daily$/i }).click();
      // After the round-trip, the "Next email" status replaces the "no
      // reminder configured" line. We don't pin the exact phrasing — i18n
      // formats the relative time via dayjs — just confirm we left the
      // "no reminder" state.
      await expect(page.getByText(/no reminder configured/i)).toHaveCount(0, {
        timeout: 10_000,
      });
      await expect(page.getByText(/next email/i)).toBeVisible({
        timeout: 5_000,
      });
    });

    await test.step("disable via Off preset clears the status", async () => {
      await page.getByRole("radio", { name: /^off$/i }).click();
      await expect(page.getByText(/no reminder configured/i)).toBeVisible({
        timeout: 10_000,
      });
    });
  });

  /**
   * Questline (Lore quest #32): `acceptQuest` is gated on the predecessor's
   * `completedAt` being set. While the predecessor is in flight, hitting
   * the gate fails with a 400 carrying "blocked by #N". Completing the
   * predecessor flips the dependent into an acceptable state.
   */
  test("questline gates accept on predecessor completion", async ({ page }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `questline${t}@example.com`;
    const password = "QuestlineTest123!";
    const projectTitle = `QL${t}`.slice(0, 20);

    await registerAndVerify(page, email, password);
    const projectId = await createProjectViaWizard(page, projectTitle);

    const predecessor = await apiPost<{ id: number; shortId: number }>(
      page,
      "createQuest",
      {
        projectId,
        title: `Setup${t}`,
        description: "Predecessor",
        area: "Main",
        priority: "medium",
        difficulty: 2,
        objectives: [],
        attachments: [],
      },
    );
    const follower = await apiPost<{ id: number; shortId: number }>(
      page,
      "createQuest",
      {
        projectId,
        title: `Follower${t}`,
        description: "Depends on the setup",
        area: "Main",
        priority: "medium",
        difficulty: 2,
        objectives: [],
        attachments: [],
        dependsOn: predecessor.id,
      },
    );

    await test.step("accepting the follower fails while predecessor is open", async () => {
      // `acceptQuest` is GET (no body schema) so the action path is the
      // canonical /api/acceptQuest/:id.
      const result = (await page.evaluate(async (id) => {
        const r = await fetch(`/api/acceptQuest/${id}`, {
          method: "GET",
          credentials: "include",
        });
        return { status: r.status, body: await r.text() };
      }, follower.id)) as { status: number; body: string };
      expect(result.status).toBe(400);
      expect(result.body.toLowerCase()).toContain("blocked by");
      expect(result.body).toContain(`#${predecessor.shortId}`);
    });

    await test.step("complete the predecessor, then accept the follower", async () => {
      await page.evaluate(async (id) => {
        const accept = await fetch(`/api/acceptQuest/${id}`, {
          method: "GET",
          credentials: "include",
        });
        if (!accept.ok) {
          throw new Error(`accept: ${accept.status} ${await accept.text()}`);
        }
        const complete = await fetch(`/api/completeQuest/${id}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!complete.ok) {
          throw new Error(
            `complete: ${complete.status} ${await complete.text()}`,
          );
        }
      }, predecessor.id);

      const acceptFollower = (await page.evaluate(async (id) => {
        const r = await fetch(`/api/acceptQuest/${id}`, {
          method: "GET",
          credentials: "include",
        });
        return { status: r.status, body: await r.text() };
      }, follower.id)) as { status: number; body: string };
      expect(acceptFollower.status).toBe(200);
    });

    await test.step("follower view surfaces the Unblocked chip", async () => {
      await page.goto(`/p/${projectId}/q/${follower.shortId}`);
      await page.waitForLoadState("networkidle");
      await expect(
        page.getByText(new RegExp(`unblocked.*#${predecessor.shortId}`, "i")),
      ).toBeVisible({ timeout: 10_000 });
    });
  });

  /**
   * Questline picker (Lore quest #119): the dependency engine + view already
   * exist; this covers the new UI surface — setting `dependsOn` from the quest
   * edit form's searchable picker, then confirming the dependency persisted
   * (the follower's view flips to "Blocked by #predecessor").
   */
  test("set a quest dependency via the edit-form picker", async ({ page }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `deppick${t}@example.com`;
    const password = "DepPick123!";
    const projectTitle = `DP${t}`.slice(0, 20);

    await registerAndVerify(page, email, password);
    const projectId = await createProjectViaWizard(page, projectTitle);

    const predecessor = await apiPost<{ id: number; shortId: number }>(
      page,
      "createQuest",
      {
        projectId,
        title: `Setup${t}`,
        description: "Predecessor",
        area: "Main",
        priority: "medium",
        difficulty: 2,
        objectives: [],
        attachments: [],
      },
    );
    const follower = await apiPost<{ id: number; shortId: number }>(
      page,
      "createQuest",
      {
        projectId,
        title: `Follow${t}`,
        description: "Will depend on the setup",
        area: "Main",
        priority: "medium",
        difficulty: 2,
        objectives: [],
        attachments: [],
      },
    );

    await page.goto(`/p/${projectId}/q/${follower.shortId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(`Follow${t}`).first()).toBeVisible({
      timeout: 10_000,
    });

    await test.step("open edit, pick the predecessor as dependency, save", async () => {
      await page.getByRole("button", { name: "Edit" }).first().click();
      // The picker trigger reads "No dependency" until one is chosen.
      await page.getByRole("button", { name: /no dependency/i }).click();
      const search = page.getByPlaceholder("Search quests…");
      await search.fill(`Setup${t}`);
      await page
        .getByRole("option", { name: new RegExp(`#${predecessor.shortId}\\b`) })
        .click();
      // Trigger reflects the selection; the popover closes.
      await expect(
        page.getByRole("button", {
          name: new RegExp(`#${predecessor.shortId}\\b`),
        }),
      ).toBeVisible({ timeout: 5_000 });
      await expect(search).toBeHidden();
      // Base UI parks `pointer-events: none` on <body> for a beat after a
      // popover closes; wait for it to clear so the submit click lands.
      await page.waitForFunction(
        () => document.body.style.pointerEvents !== "none",
      );
      await page.getByRole("button", { name: /update quest/i }).click();
      // A successful update closes the edit sheet.
      await expect(
        page.getByRole("dialog", { name: /update quest/i }),
      ).toBeHidden({ timeout: 10_000 });
    });

    await test.step("follower view now shows it is blocked by the predecessor", async () => {
      await page.goto(`/p/${projectId}/q/${follower.shortId}`);
      await page.waitForLoadState("networkidle");
      await expect(
        page.getByText(new RegExp(`blocked by.*#${predecessor.shortId}`, "i")),
      ).toBeVisible({ timeout: 10_000 });
    });
  });

  /**
   * Completion summary (Lore quest #56): the "Complete with summary" path
   * persists `completionMessage` on the quest, which then surfaces as a
   * "Completion Summary" section on the quest view + a single-line
   * preview under the "At Long Last" history entry.
   */
  test("complete-with-summary persists and renders", async ({ page }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `summary${t}@example.com`;
    const password = "SummaryTest123!";
    const projectTitle = `SM${t}`.slice(0, 20);
    const summaryText = `Shipped the thing on ${t}. Files touched: a.ts, b.ts.`;

    await registerAndVerify(page, email, password);
    const projectId = await createProjectViaWizard(page, projectTitle);

    const { shortId } = await apiPost<{ id: number; shortId: number }>(
      page,
      "createQuest",
      {
        projectId,
        title: `Summary${t}`,
        description: "Quest under summary test",
        area: "Main",
        priority: "medium",
        difficulty: 2,
        objectives: [],
        attachments: [],
      },
    );

    await page.goto(`/p/${projectId}/q/${shortId}`);
    await page.waitForLoadState("networkidle");

    // Accept first — Complete is only enabled on accepted quests.
    await page
      .getByRole("button", { name: /sign and accept|accept.*quest/i })
      .click();
    await expect(
      page.getByRole("button", { name: /complete.*quest/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    await test.step("open the completion dialog and submit with summary", async () => {
      // Toolbar Complete button + dialog "Complete with summary" both
      // match /complete.*quest|complete with summary/. Disambiguate by
      // role and position — toolbar button comes first in DOM order.
      await page
        .getByRole("button", { name: /complete.*quest/i })
        .first()
        .click();
      // Dialog presents the shared markdown editor (contenteditable).
      const editor = page.locator('.lore-mdx [contenteditable="true"]').first();
      await expect(editor).toBeVisible({ timeout: 10_000 });
      await editor.click();
      await editor.fill(summaryText);
      await page
        .getByRole("button", { name: /complete with summary/i })
        .click();
      await page.waitForLoadState("networkidle");
    });

    await test.step("summary section + history preview render the message", async () => {
      // Completion handler navigates back to the board. Re-open the quest
      // view by clicking its row instead of `page.goto` so we exercise
      // the SPA router (goto would force a hard reload + Turnstile
      // polling delays).
      await page.waitForURL(new RegExp(`/p/${projectId}/?$`), {
        timeout: 15_000,
      });
      await page.goto(`/p/${projectId}/q/${shortId}`);
      await page.waitForLoadState("domcontentloaded");
      // First make sure the quest view actually loaded — the title is
      // always rendered for a valid shortId.
      await expect(page.getByText(`Summary${t}`).first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText(/completion summary/i)).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByText(summaryText).first()).toBeVisible();
    });
  });

  /**
   * Wiki-links in quest descriptions (Tier 1). A description carrying
   * `[[#N]]` (folio) and `[[quest:#N]]` (quest) renders the resolved
   * targets as clickable links — the same `[[...]]` syntax folios
   * already support, now applied to the read-only description render.
   */
  test("wiki-links in a quest description render as clickable links", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `wikilink${t}@example.com`;
    const password = "WikiLink123!";
    const projectTitle = `WL${t}`.slice(0, 20);

    await registerAndVerify(page, email, password);
    const projectId = await createProjectViaWizard(page, projectTitle);

    // A folio to link to via the bare `[[#N]]` form.
    const folio = await apiPost<{ shortId: number }>(page, "create", {
      title: `Lore${t}`,
      projectId,
      content: "",
    });

    // A quest to link to via the `[[quest:#N]]` form.
    const target = await apiPost<{ id: number; shortId: number }>(
      page,
      "createQuest",
      {
        projectId,
        title: `Target${t}`,
        description: "Link target",
        area: "Main",
        priority: "low",
        difficulty: 1,
        objectives: [],
        attachments: [],
      },
    );

    // The quest whose description carries the links.
    const host = await apiPost<{ id: number; shortId: number }>(
      page,
      "createQuest",
      {
        projectId,
        title: `Host${t}`,
        description: `See folio [[#${folio.shortId}]] and quest [[quest:#${target.shortId}]].`,
        area: "Main",
        priority: "low",
        difficulty: 1,
        objectives: [],
        attachments: [],
      },
    );

    await page.goto(`/p/${projectId}/q/${host.shortId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(`Host${t}`).first()).toBeVisible({
      timeout: 10_000,
    });

    await test.step("folio link resolves to the folio route", async () => {
      const link = page.locator(
        `a[href="/p/${projectId}/folios/${folio.shortId}"]`,
      );
      await expect(link).toBeVisible({ timeout: 10_000 });
      await expect(link).toHaveText(`Lore${t}`);
    });

    await test.step("quest link resolves to the quest route", async () => {
      const link = page.locator(
        `a[href="/p/${projectId}/q/${target.shortId}"]`,
      );
      await expect(link).toBeVisible();
      await expect(link).toHaveText(`Target${t}`);
    });
  });

  /**
   * Shelving: set a quest aside as out of scope without deleting it. The
   * quest leaves the default board listing, comes back under the "Shelved"
   * status filter, and unshelves from the quest view.
   */
  test("shelve removes a quest from the board until filtered", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `shelve${t}@example.com`;
    const password = "ShelveTest123!";
    const projectTitle = `SC${t}`.slice(0, 20);
    const questTitle = `ShelveMe${t}`;

    await registerAndVerify(page, email, password);
    const projectId = await createProjectViaWizard(page, projectTitle);

    const { shortId } = await apiPost<{
      id: number;
      shortId: number;
    }>(page, "createQuest", {
      projectId,
      title: questTitle,
      description: "Seeded quest for shelve e2e",
      area: "Main",
      priority: "low",
      difficulty: 1,
      objectives: [],
      attachments: [],
    });

    await test.step("shelve from the quest view", async () => {
      await page.goto(`/p/${projectId}/q/${shortId}`);
      await page.waitForLoadState("networkidle");

      await page.getByRole("button", { name: /^shelve$/i }).click();
      await expect(
        page.getByRole("alertdialog", { name: /shelve this quest/i }),
      ).toBeVisible({ timeout: 5_000 });
      await page.getByRole("button", { name: /shelve quest/i }).click();

      // The header picks up a muted "Shelved" badge, and the footer flips
      // to the reverse action.
      await expect(
        page.getByRole("button", { name: /^unshelve$/i }),
      ).toBeVisible({ timeout: 10_000 });
    });

    await test.step("shelved quest is gone from the default board", async () => {
      await page.goto(`/p/${projectId}/`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(questTitle).first()).toBeHidden({
        timeout: 10_000,
      });
    });

    await test.step("Shelved filter brings it back", async () => {
      // The filter Select trigger carries no accessible name (the Control's
      // `inputProps` aria-label lands on the hidden input, not the trigger),
      // so target it by the value it currently displays.
      await page
        .getByRole("combobox")
        .filter({ hasText: "All status" })
        .click();
      await page.getByRole("option", { name: "Shelved" }).click();
      await expect(page.getByText(questTitle).first()).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("unshelve returns it to the backlog", async () => {
      await page.goto(`/p/${projectId}/q/${shortId}`);
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: /^unshelve$/i }).click();
      await expect(page.getByRole("button", { name: /^shelve$/i })).toBeVisible(
        { timeout: 10_000 },
      );

      await page.goto(`/p/${projectId}/`);
      await page.waitForLoadState("networkidle");
      // Board filters persist per project (#113), so the "Shelved" choice
      // from the previous step is still applied — clear it before asserting
      // the quest is back in the normal listing.
      await page.getByRole("button", { name: "Reset filters" }).click();
      await expect(page.getByText(questTitle).first()).toBeVisible({
        timeout: 10_000,
      });
    });
  });

  /**
   * Board > Row actions > Delete now goes through a confirm dialog
   * (`useDialog().confirm`) before hitting `deleteQuest`. Cancel keeps the
   * row; Confirm removes it. Guards against an accidental one-click delete.
   */
  test("row delete requires confirmation", async ({ page }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `delete${t}@example.com`;
    const password = "DeleteTest123!";
    const projectTitle = `DC${t}`.slice(0, 20);
    const questTitle = `DeleteMe${t}`;

    await registerAndVerify(page, email, password);
    const projectId = await createProjectViaWizard(page, projectTitle);

    await apiPost<{ id: number; shortId: number }>(page, "createQuest", {
      projectId,
      title: questTitle,
      description: "Seeded quest for delete-confirm e2e",
      area: "Main",
      priority: "low",
      difficulty: 1,
      objectives: [],
      attachments: [],
    });

    await page.goto(`/p/${projectId}/`);
    await expect(page.getByText(questTitle).first()).toBeVisible({
      timeout: 10_000,
    });

    const openRowActions = async () => {
      await page.getByRole("button", { name: "Open row actions" }).click();
      await page.getByRole("menuitem", { name: "Delete Quest" }).click();
    };

    await test.step("cancel branch keeps the quest", async () => {
      await openRowActions();
      await expect(
        page.getByRole("alertdialog", { name: /delete this quest/i }),
      ).toBeVisible({ timeout: 5_000 });
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByText(questTitle).first()).toBeVisible();
    });

    await test.step("confirm branch removes the quest", async () => {
      await openRowActions();
      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByText(questTitle).first()).toBeHidden({
        timeout: 10_000,
      });
    });
  });

  /**
   * Feedback #17: typing a new area name and pressing Enter must create it.
   * Base UI's `autoHighlight` is off by default, so nothing was highlighted
   * while typing and Enter had no target — the `+ Create "…"` row could only
   * be clicked. Also covers the non-regression side: a query that matches an
   * existing area selects that area rather than creating a near-duplicate.
   */
  test("area combobox creates an area on Enter", async ({ page }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `area${t}@example.com`;
    const password = "AreaTest123!";
    const projectTitle = `ZC${t}`.slice(0, 20);

    await registerAndVerify(page, email, password);
    const projectId = await createProjectViaWizard(page, projectTitle);

    const areaCombobox = page.getByRole("combobox", { name: "Area" });
    const areaSearch = page.getByRole("combobox", { name: "Search…" });

    const openQuestForm = async () => {
      await page.getByRole("button", { name: "Create Quest" }).click();
      await expect(areaCombobox).toBeVisible({ timeout: 10_000 });
    };

    await page.goto(`/p/${projectId}/`);
    await openQuestForm();

    await test.step("Enter creates the typed area", async () => {
      await areaCombobox.click();
      await areaSearch.fill("Donjon");
      await expect(
        page.getByRole("option", { name: 'Create "Donjon"' }),
      ).toBeVisible({ timeout: 5_000 });
      await areaSearch.press("Enter");
      // The trigger shows the freshly created entry — no click on the
      // "+ Create" row needed.
      await expect(areaCombobox).toContainText("Donjon");
    });

    await test.step("the created area reaches the quest", async () => {
      await page.getByRole("textbox", { name: "Name" }).fill(`Q${t}`);
      await page.locator("form button[type=submit]").click();
      await page.waitForURL(/\/p\/\d+\/q\/\d+/, { timeout: 15_000 });
      await page.goto(`/p/${projectId}/settings/areas`);
      await expect(page.getByRole("cell", { name: "Donjon" })).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("Enter on a partial query picks the existing area", async () => {
      await page.goto(`/p/${projectId}/`);
      await openQuestForm();
      await areaCombobox.click();
      await areaSearch.fill("Don");
      await expect(page.getByRole("option", { name: "Donjon" })).toBeVisible({
        timeout: 5_000,
      });
      await areaSearch.press("Enter");
      await expect(areaCombobox).toContainText("Donjon");
    });
  });

  /**
   * Kanban is a view of the Quests page, not its own route
   * (the great rename, Task 8). `/p/:id/kanban` used to render the board;
   * now it must not.
   */
  test("kanban is a view of the quests page, not a route", async ({ page }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `kanban${t}@example.com`;
    const password = "KanbanTest123!";
    const projectTitle = `KV${t}`.slice(0, 20);

    await registerAndVerify(page, email, password);
    const projectId = await createProjectViaWizard(page, projectTitle);

    await page.goto(`/p/${projectId}/`);
    await page.getByTestId("quests-view-kanban").click();
    await expect(page.getByTestId("kanban-board")).toBeVisible({
      timeout: 10_000,
    });

    await page.getByTestId("quests-view-list").click();
    await expect(page.getByTestId("quests-table")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("kanban-board")).toHaveCount(0);

    // The old route is gone.
    await page.goto(`/p/${projectId}/kanban`);
    await expect(page.getByTestId("kanban-board")).toHaveCount(0);
  });

  /**
   * The view-switcher rail is the only entry point to the board since the
   * sidebar entry left with the route (#135). It has to reach the board and
   * come back, remember the choice across a reload, and — since #156 —
   * do all of that without touching the URL.
   */
  test("view switcher reaches the kanban board and remembers the choice", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `viewrail${t}@example.com`;
    const password = "ViewRail123!";
    const projectTitle = `VR${t}`.slice(0, 20);

    await registerAndVerify(page, email, password);
    const projectId = await createProjectViaWizard(page, projectTitle);

    await page.goto(`/p/${projectId}/`);
    await expect(page.getByTestId("quests-table")).toBeVisible({
      timeout: 10_000,
    });

    await test.step("rail switches to the board and back", async () => {
      await page.getByTestId("quests-view-kanban").click();
      await expect(page.getByTestId("kanban-board")).toBeVisible({
        timeout: 10_000,
      });
      // The view is state, not a destination. It lived in `?view=kanban`
      // until #156, where the seeding effect that kept the URL in sync
      // bounced every sidebar navigation back to the board.
      expect(new URL(page.url()).search).toBe("");

      await page.getByTestId("quests-view-list").click();
      await expect(page.getByTestId("quests-table")).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("a bare URL reopens the last view used", async () => {
      await page.getByTestId("quests-view-kanban").click();
      await expect(page.getByTestId("kanban-board")).toBeVisible({
        timeout: 10_000,
      });

      await page.goto(`/p/${projectId}/`);
      await expect(page.getByTestId("kanban-board")).toBeVisible({
        timeout: 10_000,
      });
    });

    // #156. The board used to trap the project on itself: the seeding
    // effect that put `?view=kanban` back on a bare `/p/:id/` also fired on
    // the OUTGOING render of a navigation away — `useRouterState` is a
    // global store, so the leaving page saw the next route's empty query
    // and pushed straight back. Every sidebar link was dead while the board
    // was the stored view. Arriving proves nothing here: the bounce was a
    // second navigation landing after the first succeeded, so the URL has
    // to still be there once the outgoing page has finished unmounting.
    await test.step("leaving the board actually leaves it", async () => {
      await expect(page.getByTestId("kanban-board")).toBeVisible({
        timeout: 10_000,
      });

      await page.locator(`a[href="/p/${projectId}/folios"]`).first().click();
      await page.waitForURL(`**/p/${projectId}/folios`, { timeout: 15_000 });
      await page.waitForTimeout(1_500);
      expect(new URL(page.url()).pathname).toBe(`/p/${projectId}/folios`);

      // The Settings entry points at the layout's default child, hence the
      // prefix match rather than an exact href.
      await page.locator(`a[href^="/p/${projectId}/settings"]`).first().click();
      await page.waitForURL(`**/p/${projectId}/settings**`, {
        timeout: 15_000,
      });
      await page.waitForTimeout(1_500);
      expect(new URL(page.url()).pathname).toContain(
        `/p/${projectId}/settings`,
      );
    });

    await test.step("back on the board for the layout checks", async () => {
      await page.goto(`/p/${projectId}/`);
      await expect(page.getByTestId("kanban-board")).toBeVisible({
        timeout: 10_000,
      });
      await page.getByTestId("quests-view-list").click();
      await expect(page.getByTestId("quests-table")).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("the view bar is above the quest log and never moves", async () => {
      // #153: the switcher used to be rendered by the Quests PAGE, which put
      // it between the quest log and the table — reading as a control for the
      // table rather than for the surface. It is now the first child of the
      // content area, outside the layout's three-way branch.
      //
      // #163 turned it from a vertical left rail into a horizontal top bar,
      // which rotates the invariant onto the other axis: its y must be smaller
      // than the log's and identical under the board (which has no log at all
      // and goes full width). Being outside the branch is what buys that, on
      // whichever axis — anything rendered from inside a branch is necessarily
      // right of, and below, the quest log.
      await page.goto(`/p/${projectId}/`);
      await expect(page.getByTestId("quests-table")).toBeVisible({
        timeout: 10_000,
      });
      const barInList = await page
        .getByTestId("quests-view-switcher")
        .boundingBox();
      const log = await page.getByTestId("quest-log").boundingBox();
      if (!barInList || !log) throw new Error("missing bounding boxes");
      expect(barInList.y).toBeLessThan(log.y);

      await page.getByTestId("quests-view-kanban").click();
      await expect(page.getByTestId("kanban-board")).toBeVisible({
        timeout: 10_000,
      });
      const barInKanban = await page
        .getByTestId("quests-view-switcher")
        .boundingBox();
      if (!barInKanban) throw new Error("missing bounding box");
      expect(barInKanban.y).toBe(barInList.y);

      // And it survives opening a quest: the log is shown on the detail
      // route too, so a bar that vanished there would slide the log up.
      await page.goto(`/p/${projectId}/`);
      const { shortId } = await apiPost<{ shortId: number }>(
        page,
        "createQuest",
        {
          projectId,
          title: `RailProbe${t}`,
          description: "Seeded so the detail route has something to open",
          area: "Main",
          priority: "low",
          difficulty: 1,
          objectives: [],
          attachments: [],
        },
      );
      await page.goto(`/p/${projectId}/q/${shortId}`);
      await expect(page.getByTestId("quest-log")).toBeVisible({
        timeout: 10_000,
      });
      const barInDetail = await page
        .getByTestId("quests-view-switcher")
        .boundingBox();
      if (!barInDetail) throw new Error("missing bounding box");
      expect(barInDetail.y).toBe(barInList.y);
    });

    await test.step("the view bar disappears when kanban is off", async () => {
      await setProjectFeature(page, projectId, "kanban", false);
      await page.goto(`/p/${projectId}/`);
      await expect(page.getByTestId("quests-table")).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByTestId("quests-view-switcher")).toHaveCount(0);
    });
  });

  /**
   * Shelve is reversible and Delete is not, so Shelve must be at least as
   * reachable — one click from the list, same as Delete (#136). The entry is
   * state-aware: a shelved row offers Unshelve instead, never both.
   */
  test("shelve and unshelve from the quests table row actions", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `rowshelve${t}@example.com`;
    const password = "RowShelve123!";
    const projectTitle = `RS${t}`.slice(0, 20);
    const questTitle = `RowShelveMe${t}`;

    await registerAndVerify(page, email, password);
    const projectId = await createProjectViaWizard(page, projectTitle);

    await apiPost(page, "createQuest", {
      projectId,
      title: questTitle,
      description: "Seeded quest for row-action shelve e2e",
      area: "Main",
      priority: "low",
      difficulty: 1,
      objectives: [],
      attachments: [],
    });

    await page.goto(`/p/${projectId}/`);
    await expect(page.getByText(questTitle).first()).toBeVisible({
      timeout: 10_000,
    });

    await test.step("shelve from the row menu", async () => {
      await page.getByRole("button", { name: "Open row actions" }).click();
      await page.getByRole("menuitem", { name: /shelve quest/i }).click();
      await expect(
        page.getByRole("alertdialog", { name: /shelve this quest/i }),
      ).toBeVisible({ timeout: 5_000 });
      await page.getByRole("button", { name: /shelve quest/i }).click();

      // The default filter hides shelved quests server-side, so the row
      // leaves the table rather than changing appearance.
      await expect(page.getByText(questTitle).first()).toBeHidden({
        timeout: 10_000,
      });
    });

    await test.step("the shelved row offers Unshelve, not Shelve", async () => {
      await page
        .getByRole("combobox")
        .filter({ hasText: "All status" })
        .click();
      await page.getByRole("option", { name: "Shelved" }).click();
      await expect(page.getByText(questTitle).first()).toBeVisible({
        timeout: 10_000,
      });

      await page.getByRole("button", { name: "Open row actions" }).click();
      await expect(
        page.getByRole("menuitem", { name: /unshelve quest/i }),
      ).toBeVisible({ timeout: 5_000 });
      await expect(
        page.getByRole("menuitem", { name: /^shelve quest$/i }),
      ).toHaveCount(0);

      await page.getByRole("menuitem", { name: /unshelve quest/i }).click();
      await expect(page.getByText(questTitle).first()).toBeHidden({
        timeout: 10_000,
      });
    });
  });
});
