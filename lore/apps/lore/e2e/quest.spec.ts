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
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const { id: questId, shortId } = await apiPost<{
      id: number;
      shortId: number;
    }>(page, "createQuest", {
      projectId,
      title: questTitle,
      description: "Seeded quest for e2e",
      area: "Main",
      priority: "medium",
      estimateMinutes: 30,
      objectives: [],
      attachments: [],
    });
    expect(questId).toBeGreaterThan(0);
    expect(shortId).toBeGreaterThan(0);

    await test.step("open quest view", async () => {
      await page.goto(`/${projectSlug}/quests/${shortId}`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(questTitle).first()).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("the estimate is hidden until the project opts in", async () => {
      // `questEstimate` is off by default — estimation is a methodology, not
      // a default. The quest above was seeded WITH `estimateMinutes: 30`, so
      // this also pins that the switch hides stored data rather than the API
      // refusing to keep it.
      await expect(page.getByText(/~30m/)).toHaveCount(0);

      await setProjectFeature(page, projectId, "questEstimate");
      await page.reload();
      await page.waitForLoadState("networkidle");

      // With the switch on, the stored 30m surfaces as a `~30m` badge in the
      // quest view header — the same value, never re-entered.
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
      // Completing keeps the page mount where it is — it used to push back
      // to the quest list.
      await page.waitForLoadState("networkidle");
      await expect(page).toHaveURL(
        new RegExp(`/${projectSlug}/quests/${shortId}$`),
      );
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
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

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
      objectives: [],
      attachments: [],
    });

    await page.goto(`/${projectSlug}/quests/${shortId}`);
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
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const predecessor = await apiPost<{ id: number; shortId: number }>(
      page,
      "createQuest",
      {
        projectId,
        title: `Setup${t}`,
        description: "Predecessor",
        area: "Main",
        priority: "medium",
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
      await page.goto(`/${projectSlug}/quests/${follower.shortId}`);
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
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const predecessor = await apiPost<{ id: number; shortId: number }>(
      page,
      "createQuest",
      {
        projectId,
        title: `Setup${t}`,
        description: "Predecessor",
        area: "Main",
        priority: "medium",
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
        objectives: [],
        attachments: [],
      },
    );

    await page.goto(`/${projectSlug}/quests/${follower.shortId}`);
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
      await page.goto(`/${projectSlug}/quests/${follower.shortId}`);
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
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const { shortId } = await apiPost<{ id: number; shortId: number }>(
      page,
      "createQuest",
      {
        projectId,
        title: `Summary${t}`,
        description: "Quest under summary test",
        area: "Main",
        priority: "medium",
        objectives: [],
        attachments: [],
      },
    );

    await page.goto(`/${projectSlug}/quests/${shortId}`);
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
      // The dialog presents the shared markdown editor. Quest surfaces
      // open in Edit mode, so CodeMirror is already mounted — but its
      // surface is a contenteditable, so the text is typed, not filled.
      const editor = page.locator(".lore-md-edit .cm-content").first();
      await expect(editor).toBeVisible({ timeout: 10_000 });
      await editor.click();
      await editor.pressSequentially(summaryText);
      await page
        .getByRole("button", { name: /complete with summary/i })
        .click();
      await page.waitForLoadState("networkidle");
    });

    await test.step("the page stays put and renders the summary in place", async () => {
      // Completing used to push back to the quest list, throwing the summary
      // away at the exact moment its writer wants to see it rendered. The
      // page mount now stays on the quest — no navigation, no re-open.
      await expect(page).toHaveURL(
        new RegExp(`/${projectSlug}/quests/${shortId}$`),
        { timeout: 15_000 },
      );
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
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

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
        objectives: [],
        attachments: [],
      },
    );

    await page.goto(`/${projectSlug}/quests/${host.shortId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(`Host${t}`).first()).toBeVisible({
      timeout: 10_000,
    });

    await test.step("folio link resolves to the folio route", async () => {
      const link = page.locator(
        `a[href="/${projectSlug}/folios/${folio.shortId}"]`,
      );
      await expect(link).toBeVisible({ timeout: 10_000 });
      await expect(link).toHaveText(`Lore${t}`);
    });

    await test.step("quest link resolves to the quest route", async () => {
      const link = page.locator(
        `a[href="/${projectSlug}/quests/${target.shortId}"]`,
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
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const { shortId } = await apiPost<{
      id: number;
      shortId: number;
    }>(page, "createQuest", {
      projectId,
      title: questTitle,
      description: "Seeded quest for shelve e2e",
      area: "Main",
      priority: "low",
      objectives: [],
      attachments: [],
    });

    await test.step("shelve from the quest view", async () => {
      await page.goto(`/${projectSlug}/quests/${shortId}`);
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
      await page.goto(`/${projectSlug}/`);
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
      await page.goto(`/${projectSlug}/quests/${shortId}`);
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: /^unshelve$/i }).click();
      await expect(page.getByRole("button", { name: /^shelve$/i })).toBeVisible(
        { timeout: 10_000 },
      );

      await page.goto(`/${projectSlug}/`);
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
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    await apiPost<{ id: number; shortId: number }>(page, "createQuest", {
      projectId,
      title: questTitle,
      description: "Seeded quest for delete-confirm e2e",
      area: "Main",
      priority: "low",
      objectives: [],
      attachments: [],
    });

    await page.goto(`/${projectSlug}/`);
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
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const areaCombobox = page.getByRole("combobox", { name: "Area" });
    const areaSearch = page.getByRole("combobox", { name: "Search…" });

    const openQuestForm = async () => {
      await page.getByRole("button", { name: "Create Quest" }).click();
      await expect(areaCombobox).toBeVisible({ timeout: 10_000 });
    };

    await page.goto(`/${projectSlug}/`);
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
      await page.waitForURL(/\/quests\/\d+/, { timeout: 15_000 });
      await page.goto(`/${projectSlug}/settings/areas`);
      await expect(page.getByRole("cell", { name: "Donjon" })).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("Enter on a partial query picks the existing area", async () => {
      await page.goto(`/${projectSlug}/`);
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
   * (the great rename, Task 8). `/:projectSlug/kanban` used to render the board;
   * now it must not.
   */
  test("kanban is a view of the quests page, not a route", async ({ page }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `kanban${t}@example.com`;
    const password = "KanbanTest123!";
    const projectTitle = `KV${t}`.slice(0, 20);

    await registerAndVerify(page, email, password);
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    await page.goto(`/${projectSlug}/`);
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
    await page.goto(`/${projectSlug}/kanban`);
    await expect(page.getByTestId("kanban-board")).toHaveCount(0);
  });

  /**
   * Collapsing the quest log leaves a rail, and the choice outlives the tab.
   *
   * Its own `test()` rather than a step on an existing one: the preference is
   * cookie-backed and Playwright gives each test a fresh context, so this
   * starts from "nobody has chosen yet" and cannot leak a collapsed pane into
   * a sibling test that asserts `quest-log` is visible (two already do).
   *
   * The RELOAD is the assertion that matters. Collapsing and seeing the rail
   * only proves a React state flip; the requirement is that the pane is still
   * collapsed on a fresh document, which is the half that fails if the atom
   * loses its `persist` or moves to localStorage — where `ProjectView`, which
   * picks this layout during SSR, cannot read it.
   */
  /**
   * The header's back arrow (quest #1221). It replaced a close cross that
   * read as a dialog affordance on a page that is not a dialog.
   *
   * Two branches, and the second is the one worth a test: `router.back()`
   * alone cannot tell whether there is anywhere to go, so a deep link would
   * either do nothing or walk out of the app. `canGoBack` answers that from
   * the `alephaKey` history stamp, and the arrow falls back to the quest
   * list when the answer is no.
   */
  test("the header arrow goes back, and falls back to the list on a deep link", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `back${t}@example.com`;
    const password = "BackArrow123!";
    const projectTitle = `BA${t}`.slice(0, 20);

    await registerAndVerify(page, email, password);
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const { shortId } = await apiPost<{ id: number; shortId: number }>(
      page,
      "createQuest",
      {
        projectId,
        title: `Back${t}`,
        description: "Seeded for the back arrow",
        area: "Main",
        priority: "medium",
        objectives: [],
        attachments: [],
      },
    );

    await test.step("the description is set in the reading face", async () => {
      await page.goto(`/${projectSlug}/quests/${shortId}`);
      await page.waitForLoadState("networkidle");

      // Literata is lazy-loaded and the stack falls back silently, so the
      // failure mode this guards is the class never reaching the prose root
      // — which looks like "close enough" rather than like a bug.
      const family = await page
        .getByText("Seeded for the back arrow")
        .evaluate((el) => getComputedStyle(el).fontFamily);
      expect(family).toContain("Literata");
    });

    await test.step("the breadcrumb reads Project > Quests > #shortId", async () => {
      await page.goto(`/${projectSlug}/quests/${shortId}`);
      await page.waitForLoadState("networkidle");

      const crumbs = page.getByRole("navigation", { name: "breadcrumb" });
      // Assert the anchor, not just the label: `BreadcrumbPage` also carries
      // `role="link"`, so a dead crumb matches the locator and only the href
      // separates the two. The detail route had no Quests crumb at all until
      // now — `SECTION_LABEL_KEYS` simply had no entry for it.
      await expect(
        crumbs.getByRole("link", { name: "Quests" }),
      ).toHaveAttribute("href", `/${projectSlug}/`, { timeout: 15_000 });
      // The leaf is the number, and it is inert — it is the open page.
      await expect(crumbs.getByText(`#${shortId}`)).toBeVisible();
    });

    await test.step("a deep link has no in-app history, so it lands on the list", async () => {
      // `page.goto` is a real load: this entry IS the one the app booted
      // into, which is exactly the case the fallback exists for.
      await page.goto(`/${projectSlug}/quests/${shortId}`);
      await page.waitForLoadState("networkidle");

      await page.getByRole("button", { name: /^back$/i }).click();
      await expect(page).toHaveURL(new RegExp(`/${projectSlug}/?$`), {
        timeout: 10_000,
      });
    });

    await test.step("arriving from inside the app walks back one entry", async () => {
      // Continues from the list the step above landed on. Clicking a table
      // row is a real `router.push`, so this entry carries an alephaKey > 0
      // and the arrow takes the history branch rather than the fallback.
      await page.getByText(`Back${t}`).first().click();
      await expect(page).toHaveURL(
        new RegExp(`/${projectSlug}/quests/${shortId}$`),
        { timeout: 10_000 },
      );

      await page.getByRole("button", { name: /^back$/i }).click();
      await expect(page).toHaveURL(new RegExp(`/${projectSlug}/?$`), {
        timeout: 10_000,
      });
    });
  });

  test("the quest log collapses to a rail and remembers it", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `qlog${t}@example.com`;
    const password = "QuestLog123!";
    const projectTitle = `QL${t}`.slice(0, 20);

    await registerAndVerify(page, email, password);
    const { slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    // The log is a `lg:`-and-up fixture — below that breakpoint neither it nor
    // the rail renders at all, so the viewport has to be wide enough for the
    // pane to exist before anything here means anything.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${projectSlug}/`);
    await expect(page.getByTestId("quest-log")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("quest-log-rail")).toHaveCount(0);

    await page.getByTestId("quest-log-collapse").click();
    await expect(page.getByTestId("quest-log-rail")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("quest-log")).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("quest-log-rail")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("quest-log")).toHaveCount(0);

    await page.getByTestId("quest-log-rail").click();
    await expect(page.getByTestId("quest-log")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("quest-log-rail")).toHaveCount(0);
  });

  /**
   * The view-switcher rail is the only entry point to the board since the
   * sidebar entry left with the route (#135). It has to reach the board and
   * come back, remember the choice across a reload, and — since #156 —
   * do all of that without touching the URL.
   */
  /**
   * The card mount (quest #1221). `QuestView` is one component with two
   * mounts: this route page, and the same file inside the board's sheet at
   * half the width. `context="card"` is what tells them apart — there, the
   * reminder controls fold behind the header's overflow so the description
   * and the objectives are what a card back opens on.
   */
  test("the card back folds the reminder section behind the overflow", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `card${t}@example.com`;
    const password = "CardBack123!";
    const projectTitle = `CB${t}`.slice(0, 20);
    const questTitle = `Carded${t}`;

    await registerAndVerify(page, email, password);
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    await apiPost<{ id: number; shortId: number }>(page, "createQuest", {
      projectId,
      title: questTitle,
      description: "Seeded for the card back",
      area: "Main",
      priority: "medium",
      objectives: [],
      attachments: [],
    });

    // The reminder block is the foldable section that does not need a
    // completed quest, so it is the cheap one to drive.
    await setProjectFeature(page, projectId, "questReminder");

    await test.step("the page mount shows it inline", async () => {
      await page.goto(`/${projectSlug}/`);
      await page.getByText(questTitle).first().click();
      // Testid, not the label: the sidebar also says "Settings".
      await expect(page.getByTestId("quest-collapsible-settings")).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("the card mount folds it away, and the overflow brings it back", async () => {
      await page.goto(`/${projectSlug}/`);
      await page.getByTestId("quests-view-kanban").click();
      await expect(page.getByTestId("kanban-board")).toBeVisible({
        timeout: 10_000,
      });

      await page.getByText(questTitle).first().click();
      // The sheet renders the same component, so the description is there.
      await expect(page.getByText("Seeded for the card back")).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByTestId("quest-collapsible-settings")).toHaveCount(
        0,
      );

      await page.getByRole("button", { name: /^more$/i }).click();
      await page.getByRole("menuitem", { name: /settings/i }).click();
      await expect(page.getByTestId("quest-collapsible-settings")).toBeVisible({
        timeout: 10_000,
      });
    });
  });

  test("view switcher reaches the kanban board and remembers the choice", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `viewrail${t}@example.com`;
    const password = "ViewRail123!";
    const projectTitle = `VR${t}`.slice(0, 20);

    await registerAndVerify(page, email, password);
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    await page.goto(`/${projectSlug}/`);
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

      await page.goto(`/${projectSlug}/`);
      await expect(page.getByTestId("kanban-board")).toBeVisible({
        timeout: 10_000,
      });
    });

    // #156. The board used to trap the project on itself: the seeding
    // effect that put `?view=kanban` back on a bare `/:projectSlug/` also fired on
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

      await page.locator(`a[href="/${projectSlug}/folios"]`).first().click();
      await page.waitForURL(`**/${projectSlug}/folios`, { timeout: 15_000 });
      await page.waitForTimeout(1_500);
      expect(new URL(page.url()).pathname).toBe(`/${projectSlug}/folios`);

      // The Settings entry points at the layout's default child, hence the
      // prefix match rather than an exact href.
      await page.locator(`a[href^="/${projectSlug}/settings"]`).first().click();
      await page.waitForURL(`**/${projectSlug}/settings**`, {
        timeout: 15_000,
      });
      await page.waitForTimeout(1_500);
      expect(new URL(page.url()).pathname).toContain(
        `/${projectSlug}/settings`,
      );
    });

    await test.step("back on the board for the layout checks", async () => {
      await page.goto(`/${projectSlug}/`);
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
      await page.goto(`/${projectSlug}/`);
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

      // The detail route keeps neither. It used to hold the log at 25% and
      // the bar above it, which made opening a quest feel like a pane inside
      // the list rather than a page; the quest owns the viewport now, and a
      // bar switching between two views the page does not have is chrome
      // without a job. (This step used to assert the opposite of both.)
      await page.goto(`/${projectSlug}/`);
      const { shortId } = await apiPost<{ shortId: number }>(
        page,
        "createQuest",
        {
          projectId,
          title: `RailProbe${t}`,
          description: "Seeded so the detail route has something to open",
          area: "Main",
          priority: "low",
          objectives: [],
          attachments: [],
        },
      );
      await page.goto(`/${projectSlug}/quests/${shortId}`);
      await expect(page.getByText(`RailProbe${t}`).first()).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByTestId("quest-log")).toHaveCount(0);
      await expect(page.getByTestId("quest-log-rail")).toHaveCount(0);
      await expect(page.getByTestId("quests-view-switcher")).toHaveCount(0);
    });

    await test.step("the view bar disappears when kanban is off", async () => {
      await setProjectFeature(page, projectId, "kanban", false);
      await page.goto(`/${projectSlug}/`);
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
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    await apiPost(page, "createQuest", {
      projectId,
      title: questTitle,
      description: "Seeded quest for row-action shelve e2e",
      area: "Main",
      priority: "low",
      objectives: [],
      attachments: [],
    });

    await page.goto(`/${projectSlug}/`);
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
