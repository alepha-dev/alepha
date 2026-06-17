import { expect, test } from "@playwright/test";
import {
  apiPost,
  createCampaignViaWizard,
  registerAndVerify,
  unlockShopFeature,
} from "./_helpers.ts";

/**
 * Quest feature e2e: seeded via API (the Zone combobox is not creatable from
 * scratch in the UI), then driven through the real shadcn UI for open →
 * accept → complete.
 *
 * Per the Lore CLAUDE.md convention, each big feature owns its own spec file.
 * Campaign create + auth are covered by the helpers — kept here as setup,
 * not as the focus of the test.
 */
test.describe("Quest", () => {
  test("accept → complete from quest view", async ({ page }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `quest${t}@example.com`;
    const password = "QuestTest123!";
    const campaignTitle = `QC${t}`.slice(0, 20);
    const questTitle = `Quest${t}`;

    await registerAndVerify(page, email, password);
    const campaignId = await createCampaignViaWizard(page, campaignTitle);

    const { id: questId, shortId } = await apiPost<{
      id: number;
      shortId: number;
    }>(page, "createQuest", {
      campaignId,
      title: questTitle,
      description: "Seeded quest for e2e",
      zone: "Main",
      priority: "medium",
      difficulty: 3,
      estimateMinutes: 30,
      objectives: [],
      attachments: [],
    });
    expect(questId).toBeGreaterThan(0);
    expect(shortId).toBeGreaterThan(0);

    await test.step("open quest view", async () => {
      await page.goto(`/c/${campaignId}/q/${shortId}`);
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
      // back to the board — both leave us inside the campaign URL space.
      await page.waitForLoadState("networkidle");
      expect(page.url()).toContain(`/c/${campaignId}`);
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
    const campaignTitle = `RC${t}`.slice(0, 20);
    const questTitle = `Reminder${t}`;

    await registerAndVerify(page, email, password);
    const campaignId = await createCampaignViaWizard(page, campaignTitle);

    // Quest Reminder is a Shop feature (1g). Earn gold + buy it before
    // exercising the reminder UI.
    await unlockShopFeature(page, campaignId, "quest_reminder");

    const { shortId } = await apiPost<{
      id: number;
      shortId: number;
    }>(page, "createQuest", {
      campaignId,
      title: questTitle,
      description: "Seeded quest for reminder e2e",
      zone: "Main",
      priority: "low",
      difficulty: 2,
      objectives: [],
      attachments: [],
    });

    await page.goto(`/c/${campaignId}/q/${shortId}`);
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
    const campaignTitle = `QL${t}`.slice(0, 20);

    await registerAndVerify(page, email, password);
    const campaignId = await createCampaignViaWizard(page, campaignTitle);

    const predecessor = await apiPost<{ id: number; shortId: number }>(
      page,
      "createQuest",
      {
        campaignId,
        title: `Setup${t}`,
        description: "Predecessor",
        zone: "Main",
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
        campaignId,
        title: `Follower${t}`,
        description: "Depends on the setup",
        zone: "Main",
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
      await page.goto(`/c/${campaignId}/q/${follower.shortId}`);
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
    const campaignTitle = `DP${t}`.slice(0, 20);

    await registerAndVerify(page, email, password);
    const campaignId = await createCampaignViaWizard(page, campaignTitle);

    const predecessor = await apiPost<{ id: number; shortId: number }>(
      page,
      "createQuest",
      {
        campaignId,
        title: `Setup${t}`,
        description: "Predecessor",
        zone: "Main",
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
        campaignId,
        title: `Follow${t}`,
        description: "Will depend on the setup",
        zone: "Main",
        priority: "medium",
        difficulty: 2,
        objectives: [],
        attachments: [],
      },
    );

    await page.goto(`/c/${campaignId}/q/${follower.shortId}`);
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
      await page.goto(`/c/${campaignId}/q/${follower.shortId}`);
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
    const campaignTitle = `SM${t}`.slice(0, 20);
    const summaryText = `Shipped the thing on ${t}. Files touched: a.ts, b.ts.`;

    await registerAndVerify(page, email, password);
    const campaignId = await createCampaignViaWizard(page, campaignTitle);

    const { shortId } = await apiPost<{ id: number; shortId: number }>(
      page,
      "createQuest",
      {
        campaignId,
        title: `Summary${t}`,
        description: "Quest under summary test",
        zone: "Main",
        priority: "medium",
        difficulty: 2,
        objectives: [],
        attachments: [],
      },
    );

    await page.goto(`/c/${campaignId}/q/${shortId}`);
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
      // Dialog presents a textarea — fill the first textarea on screen.
      // The QuestDescription block lives behind a collapsible that's
      // closed by default, so the only visible textarea is the summary.
      const editor = page.locator("textarea").first();
      await expect(editor).toBeVisible({ timeout: 10_000 });
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
      await page.waitForURL(new RegExp(`/c/${campaignId}/?$`), {
        timeout: 15_000,
      });
      await page.goto(`/c/${campaignId}/q/${shortId}`);
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
    const campaignTitle = `WL${t}`.slice(0, 20);

    await registerAndVerify(page, email, password);
    const campaignId = await createCampaignViaWizard(page, campaignTitle);

    // A folio to link to via the bare `[[#N]]` form.
    const folio = await apiPost<{ shortId: number }>(page, "create", {
      title: `Lore${t}`,
      campaignId,
      content: "",
    });

    // A quest to link to via the `[[quest:#N]]` form.
    const target = await apiPost<{ id: number; shortId: number }>(
      page,
      "createQuest",
      {
        campaignId,
        title: `Target${t}`,
        description: "Link target",
        zone: "Main",
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
        campaignId,
        title: `Host${t}`,
        description: `See folio [[#${folio.shortId}]] and quest [[quest:#${target.shortId}]].`,
        zone: "Main",
        priority: "low",
        difficulty: 1,
        objectives: [],
        attachments: [],
      },
    );

    await page.goto(`/c/${campaignId}/q/${host.shortId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(`Host${t}`).first()).toBeVisible({
      timeout: 10_000,
    });

    await test.step("folio link resolves to the archive route", async () => {
      const link = page.locator(
        `a[href="/c/${campaignId}/archive/${folio.shortId}"]`,
      );
      await expect(link).toBeVisible({ timeout: 10_000 });
      await expect(link).toHaveText(`Lore${t}`);
    });

    await test.step("quest link resolves to the quest route", async () => {
      const link = page.locator(
        `a[href="/c/${campaignId}/q/${target.shortId}"]`,
      );
      await expect(link).toBeVisible();
      await expect(link).toHaveText(`Target${t}`);
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
    const campaignTitle = `DC${t}`.slice(0, 20);
    const questTitle = `DeleteMe${t}`;

    await registerAndVerify(page, email, password);
    const campaignId = await createCampaignViaWizard(page, campaignTitle);

    await apiPost<{ id: number; shortId: number }>(page, "createQuest", {
      campaignId,
      title: questTitle,
      description: "Seeded quest for delete-confirm e2e",
      zone: "Main",
      priority: "low",
      difficulty: 1,
      objectives: [],
      attachments: [],
    });

    await page.goto(`/c/${campaignId}/`);
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
});
