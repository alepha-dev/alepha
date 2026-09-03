import type { Page } from "@playwright/test";

import { MAX_QUEST_OBJECTIVES } from "../src/api/schemas/questObjectivesLimit.ts";
import { expect, test } from "./_fixtures.ts";
import {
  apiPath,
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
/**
 * Expand the quest form's Advanced block.
 *
 * Tags, objectives, estimate, due date, dependency and release moved behind a
 * collapsible, and it opens from the quest's INITIAL values - so a quest
 * carrying none of them (which is every quest these specs seed) opens the form
 * with all six hidden. A spec reaching straight for one of those fields finds
 * nothing, with `element(s) not found` rather than anything naming the cause.
 *
 * Idempotent on purpose: it reads `aria-expanded` rather than clicking blind,
 * so a quest that DOES carry an advanced value and opens expanded is left
 * alone instead of being toggled shut.
 */
const openAdvanced = async (page: Page) => {
  const toggle = page.getByTestId("collapsible-advanced");
  await expect(toggle).toBeVisible({ timeout: 15_000 });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
};

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
  /**
   * A long commit message stays inside its rail cell.
   *
   * Layout, so only a real browser can answer it: jsdom computes no widths,
   * and the failure is not a wrong class but a right one with nothing to
   * act on. `truncate` sets `white-space: nowrap`, which makes the leaf's
   * min-content equal its max-content, so the column sized itself to the
   * whole line and — being right-aligned — spilled LEFT, painting over the
   * "Commits" label.
   *
   * Asserted as a box comparison rather than by reading classes: the point
   * is that the text is inside the rail, and a class list cannot say that.
   */
  test("a long commit message stays inside the rail", async ({ page }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    await registerAndVerify(page, `commit${t}@example.com`, "QuestTest123!");
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      `CM${t}`.slice(0, 20),
    );

    const { id: questId, shortId } = await apiPost<{
      id: number;
      shortId: number;
    }>(page, "createQuest", {
      projectId,
      title: `Commit${t}`,
      description: "Seeded quest for the commits rail row",
      // One unbreakable token, for the shared cell's own guard: Epic,
      // Milestone, Assignee and Area all render plain text into it, where a
      // value with no space in it renders at max-content and — the cell
      // being right-aligned — spills left over its label, exactly as the
      // commits column did for a different reason.
      area: "Averylongsingletokenareanamewithnospaces",
      priority: "medium",
      objectives: [],
      attachments: [],
    });

    // `addQuestCommit` takes its id in the PATH, and `apiPost` posts the
    // body verbatim against the raw template — so the `:id` has to be
    // substituted here rather than passed as a field.
    const commitUrl = (await apiPath(page, "addQuestCommit")).replace(
      ":id",
      String(questId),
    );
    await page.evaluate(async (url) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sha: "ded61fa9c4e1b7d3f8a2c5e6b0d9f1a3c7e5b2da",
          message:
            "feat(lore): an app can be renamed, and the rename does not " +
            "touch reporting because SIGIL_KEY carries the project slug " +
            "and not the app name",
        }),
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${await response.text()}`);
      }
    }, commitUrl);

    await page.goto(`/${projectSlug}/quests/${shortId}`);

    const label = page.getByText("Commits", { exact: true });
    await expect(label).toBeVisible({ timeout: 15_000 });

    const row = label.locator("xpath=ancestor::div[1]/..");
    const value = row.locator("code").locator("xpath=..");

    const [rowBox, valueBox, labelBox] = await Promise.all([
      row.boundingBox(),
      value.boundingBox(),
      label.boundingBox(),
    ]);

    if (!rowBox || !valueBox || !labelBox) {
      throw new Error("commits row did not lay out");
    }

    // The two claims the bug broke, in the order it broke them: the value
    // does not start left of the label's right edge (it stopped painting
    // over it), and it does not run past the row it lives in.
    expect(valueBox.x).toBeGreaterThanOrEqual(labelBox.x + labelBox.width - 1);
    expect(valueBox.x + valueBox.width).toBeLessThanOrEqual(
      rowBox.x + rowBox.width + 1,
    );

    // Truncated, not wrapped: the sha has to survive, since it is the half
    // that identifies the commit.
    await expect(page.getByText("ded61fa")).toBeVisible();

    // And the shared cell's guard, on a row that wraps rather than truncates.
    const areaValue = page.getByText(
      "Averylongsingletokenareanamewithnospaces",
    );
    await expect(areaValue).toBeVisible();
    const areaBox = await areaValue.boundingBox();
    if (!areaBox) throw new Error("area row did not lay out");
    expect(areaBox.x).toBeGreaterThanOrEqual(rowBox.x - 1);
    expect(areaBox.x + areaBox.width).toBeLessThanOrEqual(
      rowBox.x + rowBox.width + 1,
    );
  });

  /**
   * Completing a quest with a full list of unticked objectives.
   *
   * The dialog had no height cap and no scroll container, and it is
   * `fixed top-1/2 -translate-y-1/2` — so a long waiver list grew past the
   * viewport in both directions and took the summary editor and the confirm
   * button with it. The quest could not be closed at all.
   *
   * Run at two viewport heights because the failure is a function of the
   * viewport rather than of the DOM: the tall case is the ordinary window,
   * and the short one is where a cap that merely MOVES the problem shows up.
   *
   * ⚠️ This used to seed twenty objectives, and cannot any more: #1505 caps a
   * quest at ten on the write path, so twenty is no longer reachable through
   * the API this test uses. Ten is now the worst case a user can create, and
   * the short viewport dropped from 600px to 500px to keep the same pressure
   * on the dialog with the smaller list.
   *
   * The dialog's own fix is count-independent — a max height plus a scroll
   * container, not a check on the number — so what it must survive is
   * "more objectives than fit", which both heights still deliver. Quests
   * created before the cap can still hold more, and this is the closest the
   * suite can get to them.
   */
  for (const height of [900, 500]) {
    test(`a quest with ${MAX_QUEST_OBJECTIVES} unticked objectives can be completed at ${height}px`, async ({
      page,
    }) => {
      test.setTimeout(90_000);

      const t = Date.now();
      await registerAndVerify(
        page,
        `waive${height}${t}@example.com`,
        "Waive123!",
      );
      const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
        page,
        `WV${height}${t}`.slice(0, 20),
      );

      const { id: questId, shortId } = await apiPost<{
        id: number;
        shortId: number;
      }>(page, "createQuest", {
        projectId,
        title: `Waive${t}`,
        description: "A full list of objectives, none of them done",
        area: "Main",
        priority: "medium",
        objectives: Array.from({ length: MAX_QUEST_OBJECTIVES }, (_, n) => ({
          title: `Objective number ${n + 1}`,
          completed: false,
        })),
        attachments: [],
      });

      await page.evaluate(async (id) => {
        const r = await fetch(`/api/acceptQuest/${id}`, {
          method: "GET",
          credentials: "include",
        });
        if (!r.ok) throw new Error(`accept: ${r.status} ${await r.text()}`);
      }, questId);

      await page.setViewportSize({ width: 1280, height });
      await page.goto(`/${projectSlug}/quests/${shortId}`);

      await page.getByRole("button", { name: /complete.*quest/i }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 15_000 });

      // The dialog fits. Both edges, because it is centred: an uncapped one
      // overflows above and below at the same time, so checking only the
      // bottom would pass on a dialog whose header had left the screen.
      const box = await dialog.boundingBox();
      if (!box) throw new Error("dialog did not lay out");
      expect(box.y).toBeGreaterThanOrEqual(-1);
      expect(box.y + box.height).toBeLessThanOrEqual(height + 1);

      // The three parts that must survive whatever the objective count.
      await expect(
        dialog.getByText(/objective number 1$/i).first(),
      ).toBeVisible();
      // "Complete with summary", not "Complete without summary" — the two
      // differ only by that suffix, so an unanchored match hits both.
      const submit = dialog.getByRole("button", {
        name: /complete with summary/i,
      });
      await expect(submit).toBeInViewport();

      // And the list is what scrolls, rather than the page.
      const scrolled = await dialog
        .locator("div.overflow-y-auto")
        .first()
        .evaluate((el) => el.scrollHeight > el.clientHeight);
      expect(scrolled).toBe(true);

      // End to end: a reason for every objective, then close the quest for
      // real. The last field is only reachable by scrolling the region
      // above, which is the half of the fix a layout assertion cannot see.
      for (let n = 0; n < MAX_QUEST_OBJECTIVES; n++) {
        await dialog
          .getByPlaceholder(/why|pourquoi/i)
          .nth(n)
          .fill(`Reason ${n + 1}`);
      }
      // The summary the button is named after. Reaching it at all is half
      // the point: before the cap it was below the fold with the button.
      await dialog.locator(".cm-content").click();
      await page.keyboard.type("Closed with a waiver for each objective.");

      await expect(submit).toBeEnabled({ timeout: 10_000 });
      await submit.click();

      await expect(page.getByText(/completed|terminé/i).first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(dialog).toBeHidden();
    });
  }

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

    await test.step("the reminder control is in the rail, already open", async () => {
      // It used to live in a Settings block that defaulted to collapsed, so
      // this step had to expand it first. The metadata rail absorbed the
      // control, so there is nothing left to open.
      await expect(page.getByRole("radio", { name: /^daily$/i })).toBeVisible({
        timeout: 10_000,
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

    await test.step("predecessor view names what it unlocks", async () => {
      // The other direction, and the one that had no coverage. The rail
      // carried a second Questline row that printed a bare "Unlocks" per
      // dependent — no number, no title, nothing to click — because it
      // passed the shortId as an i18n argument to a catalogue entry with no
      // `$1` in it. That row is deleted; this asserts the banner it
      // duplicated says all three things the row could not.
      await page.goto(`/${projectSlug}/quests/${predecessor.shortId}`);
      await page.waitForLoadState("networkidle");

      const banner = page
        .getByText(/unlocks/i)
        .locator("xpath=..")
        .first();
      await expect(banner).toBeVisible({ timeout: 10_000 });
      await expect(
        banner.getByRole("link", { name: `#${follower.shortId}` }),
      ).toBeVisible();
      await expect(banner).toContainText(`Follower${t}`);
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
      await openAdvanced(page);
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
      // Said twice on purpose: the amber banner above the description, and
      // the rail's Questline row.
      await expect(
        page
          .getByText(new RegExp(`blocked by.*#${predecessor.shortId}`, "i"))
          .first(),
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
      // The summary is the BODY of the "completed the quest" entry now, not
      // a section of its own headed "Completion summary": it is dated,
      // authored and about the quest ending, so it belongs in the feed.
      await expect(page.getByText(/completed the quest/i)).toBeVisible({
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
      await page.goto(`/${projectSlug}/quests`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(questTitle).first()).toBeHidden({
        timeout: 10_000,
      });
    });

    await test.step("Shelved filter brings it back", async () => {
      // The status filter takes several values (#1644), but its trigger is a
      // plain button again: the chips box (whose search input carried "All
      // status" as a placeholder, the handle this used to grab) was replaced
      // by a value-then-count trigger. With nothing selected it shows
      // `clearLabel` as its own text, so match on that.
      await page
        .getByRole("combobox")
        .filter({ hasText: "All status" })
        .first()
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

      await page.goto(`/${projectSlug}/quests`);
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

    await page.goto(`/${projectSlug}/quests`);
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
    const { slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const areaCombobox = page.getByRole("combobox", { name: "Area" });
    const areaSearch = page.getByRole("combobox", { name: "Search…" });

    const openQuestForm = async () => {
      // The list has two ways in since #1690: the header's create menu and
      // the table's own primary action. This test waits for the navigation
      // to the new quest, which only the header's path does: the table's
      // keeps the reader on the list by design. The header is one "+"
      // (#1684) whose menu leads with New Quest.
      await page.getByTestId("project-create-menu").click();
      await page.getByRole("menuitem", { name: "New Quest" }).click();
      await expect(areaCombobox).toBeVisible({ timeout: 10_000 });
    };

    await page.goto(`/${projectSlug}/quests`);
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
      await page.goto(`/${projectSlug}/quests`);
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
   * Kanban is its own route again (epic #2, quest #1211).
   *
   * This test used to assert the opposite — the 2026-08 rename had turned the
   * board into a view of the Quests page and `/:projectSlug/kanban` rendered
   * nothing. It inverts rather than breaks: the final assertion, that the
   * path renders no board, becomes the positive case.
   *
   * It drove the "Quest list | Kanban board" rail until #1510 removed it. The
   * sidebar entry does the same navigation, and the rail's disappearance is
   * only safe BECAUSE it does, so this now drives the sidebar.
   */
  test("kanban is a route, and the sidebar navigates to it", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `kanban${t}@example.com`;
    const password = "KanbanTest123!";
    const projectTitle = `KV${t}`.slice(0, 20);

    await registerAndVerify(page, email, password);
    const { slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    await page.goto(`/${projectSlug}/quests`);
    await page.locator(`a[href="/${projectSlug}/kanban"]`).first().click();
    await expect(page.getByTestId("kanban-board")).toBeVisible({
      timeout: 10_000,
    });
    // The switch is a navigation now, so it is addressable.
    await expect(page).toHaveURL(new RegExp(`/${projectSlug}/kanban$`));

    // The Quests entry is `/quests` now, not the bare project root: the root
    // is the Activity page.
    await page.locator(`a[href="/${projectSlug}/quests"]`).first().click();
    await expect(page.getByTestId("quests-table")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("kanban-board")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/${projectSlug}/quests$`));

    // Typing the URL reaches the board — the point of the whole change.
    await page.goto(`/${projectSlug}/kanban`);
    await expect(page.getByTestId("kanban-board")).toBeVisible({
      timeout: 10_000,
    });
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
  test("the breadcrumb walks back up from a quest, deep link included", async ({
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
      // `/quests`, not the bare project root: the list moved when Activity
      // took `/`. `SECTION_HREF_ROUTES` still names the route, so the crumb
      // followed the move without being edited.
      await expect(
        crumbs.getByRole("link", { name: "Quests" }),
      ).toHaveAttribute("href", `/${projectSlug}/quests`, { timeout: 15_000 });
      // The leaf is the number, and it is inert — it is the open page.
      await expect(crumbs.getByText(`#${shortId}`)).toBeVisible();
    });

    await test.step("the breadcrumb is the way back, on a deep link too", async () => {
      // The page mount has no back arrow any more: the breadcrumb sits
      // directly above the title and says the same thing, so the arrow was a
      // second control for one job. It survives on the CARD mount, where it
      // is the drawer's only way out.
      //
      // `page.goto` is a real load, so this entry IS the one the app booted
      // into — the case the arrow's history fallback used to exist for, and
      // the one the breadcrumb handles without needing history at all.
      await page.goto(`/${projectSlug}/quests/${shortId}`);
      await page.waitForLoadState("networkidle");

      await expect(page.getByRole("button", { name: /^back$/i })).toHaveCount(
        0,
      );

      await page
        .getByRole("navigation", { name: "breadcrumb" })
        .getByRole("link", { name: "Quests" })
        .click();
      await expect(page).toHaveURL(new RegExp(`/${projectSlug}/quests$`), {
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
    await page.goto(`/${projectSlug}/quests`);
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
   * The metadata rail (quest #1240). Body left, rail right: what the quest
   * *is*, beside what it says. The sticky bottom action bar it replaced held
   * Accept / Complete opposite Shelve and Abandon; the lifecycle verbs moved
   * up into the title row and the rest moved in here.
   */
  test("the rail states the quest, and Unassign releases it without leaving", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `rail${t}@example.com`;
    const password = "RailTest123!";
    const projectTitle = `RL${t}`.slice(0, 20);

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
        title: `Railed${t}`,
        description: "Seeded for the rail",
        area: "lore/quests",
        priority: "high",
        objectives: [],
        attachments: [],
      },
    );

    await page.goto(`/${projectSlug}/quests/${shortId}`);
    await page.waitForLoadState("networkidle");

    await test.step("rows the data can fill are stated; the rest render nothing", async () => {
      const rail = page.getByRole("complementary");
      await expect(rail.getByText("New")).toBeVisible({ timeout: 10_000 });
      await expect(rail.getByText("high")).toBeVisible();
      await expect(rail.getByText("lore/quests")).toBeVisible();
      // No epic module, no estimate module, no questline: the rail shows no
      // label waiting for data that is not coming.
      await expect(rail.getByText(/^epic$/i)).toHaveCount(0);
      await expect(rail.getByText(/^questline$/i)).toHaveCount(0);
      // Release is the exception, and deliberately so: since #1553 that row
      // is a CONTROL rather than a label, so it is always offered and reads
      // "None" until the quest is put in a release. A control that only
      // appeared once the value existed could never set it.
      await expect(rail.getByText(/^release$/i)).toHaveCount(1);
      await expect(rail.getByText(/^none$/i)).toBeVisible();
    });

    await test.step("Unassign, not Abandon, and it only appears once assigned", async () => {
      // The server clears the assignee and pushes an `unassigned` event; it
      // has never deleted anything, so neither the old label nor its trash
      // icon was true.
      await expect(page.getByRole("button", { name: /abandon/i })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("button", { name: /^unassign$/i }),
      ).toHaveCount(0);

      await page
        .getByRole("button", { name: /sign and accept|accept.*quest/i })
        .click();
      await expect(
        page.getByRole("complementary").getByText(/in progress/i),
      ).toBeVisible({ timeout: 10_000 });

      const unassign = page.getByRole("button", { name: /^unassign$/i });
      await expect(unassign).toBeVisible({ timeout: 10_000 });
      await unassign.click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: /^unassign$/i })
        .click();

      // Unassign STAYS on the quest. It releases the quest, it does not
      // remove it, so navigating back to the list read as "that is gone"
      // for something still sitting right there with its assignee cleared.
      await expect(page).toHaveURL(
        new RegExp(`/${projectSlug}/quests/${shortId}$`),
        { timeout: 10_000 },
      );
      // And the rail reflects it without a reload.
      await expect(page.getByText("In progress")).toHaveCount(0);
    });
  });

  // The card mount used to fold the completion summary behind the header's
  // overflow menu, and this test drove that menu. Both are gone: the summary
  // is an entry in the Discussion feed on either mount, so there is no
  // folded section left to reveal.

  /**
   * The board is reached from the SIDEBAR, and `/quests` stays `/quests`.
   * (`defaultSurface`, the per-project setting that could send a bare
   * project URL to the board instead, was removed with feedback #2066.)
   *
   * ⚠️ A bare `/:projectSlug` lands on **Activity** now, not on the list.
   * That is not a weakening of what this test guards: the thing under
   * guard was never "which page is the root", it was that nothing may
   * silently re-point a URL the reader chose. `e2e/activity.spec.ts` pins
   * the root's own destination.
   *
   * ⚠️ This used to drive the "Quest list | Kanban board" rail, which is gone
   * (#1510). The rail existed for two real bugs and this test is what keeps
   * them from returning by another route: the board was once unreachable from
   * the UI at all (#1135), and picking it once trapped the project on the
   * board (#1156). Both were fixed by making Kanban a route with a sidebar
   * entry, which is exactly why the rail became redundant - so the sidebar
   * entry is now the ONLY way in, and it has to work.
   */
  test("the sidebar reaches the kanban board, and the list URL stays put", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    const email = `viewrail${t}@example.com`;
    const password = "ViewRail123!";
    const projectTitle = `VR${t}`.slice(0, 20);

    await registerAndVerify(page, email, password);
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const sidebarLink = (href: string) =>
      page.locator(`a[href="/${projectSlug}${href}"]`).first();

    await page.goto(`/${projectSlug}/quests`);
    await expect(page.getByTestId("quests-table")).toBeVisible({
      timeout: 10_000,
    });

    await test.step("the rail is gone, and the sidebar is the way in", async () => {
      await expect(page.getByTestId("quests-view-switcher")).toHaveCount(0);

      await sidebarLink("/kanban").click();
      await expect(page.getByTestId("kanban-board")).toBeVisible({
        timeout: 10_000,
      });
      // The board is a destination, so this is a navigation. Still never a
      // QUERY param: `?view=kanban` is what #156 was about, and the seeding
      // effect that kept it in sync bounced every sidebar link.
      await expect(page).toHaveURL(new RegExp(`/${projectSlug}/kanban$`));
      expect(new URL(page.url()).search).toBe("");

      await sidebarLink("/quests").click();
      await expect(page.getByTestId("quests-table")).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("the list URL is stable, whatever this browser last opened", async () => {
      // Having just been on the board changes nothing: there is no stored
      // view (the cookie went with #1510) and no project setting (that went
      // with feedback #2066) that could send this anywhere else.
      await page.goto(`/${projectSlug}/quests`);
      await expect(page.getByTestId("quests-table")).toBeVisible({
        timeout: 10_000,
      });
      expect(new URL(page.url()).search).toBe("");
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
      await sidebarLink("/kanban").click();
      await expect(page.getByTestId("kanban-board")).toBeVisible({
        timeout: 10_000,
      });

      await sidebarLink("/folios").click();
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

    await test.step("the quest log still renders beside the list and the detail", async () => {
      // What the deleted layout step was really protecting: the quest log's
      // position. The rail used to sit above it and the assertions were
      // about their relative y. With the rail gone the log is simply the top
      // of the content area, on both routes that carry it.
      await page.goto(`/${projectSlug}/quests`);
      await expect(page.getByTestId("quest-log")).toBeVisible({
        timeout: 10_000,
      });

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
      await expect(page.getByTestId("quest-log")).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByTestId("quests-view-switcher")).toHaveCount(0);
    });

    await test.step("kanban off removes the sidebar entry, not the route", async () => {
      await setProjectFeature(page, projectId, "kanban", false);
      await page.goto(`/${projectSlug}/quests`);
      await expect(page.getByTestId("quests-table")).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        page.locator(`a[href="/${projectSlug}/kanban"]`),
      ).toHaveCount(0);
    });
  });

  /**
   * #1521, from feedback #2021. The Due date field was a bare
   * `<input type="date">` beside controls that all use the shared kit; it is
   * `ControlDate` now, through the `Control` the field's schema already
   * dispatches to.
   *
   * ⚠️ What is asserted is the API, not the widget. The custom control's own
   * JSDoc documented three behaviours worth keeping, and two of them are
   * invisible in the form: clearing has to send `null` (an omitted key leaves
   * the old deadline in place), and a date-only value must not be run through
   * `toISOString()`, which shifts the day backwards west of UTC.
   */
  test("a due date round-trips through the form and clears for real", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    const projectTitle = `DD${t}`.slice(0, 20);

    await registerAndVerify(page, `duedate${t}@example.com`, "DueDate123!");
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const { id: questId, shortId } = await apiPost<{
      id: number;
      shortId: number;
    }>(page, "createQuest", {
      projectId,
      title: `Has a deadline ${t}`,
      description: "<p>x</p>",
      area: "Main",
      priority: "low",
      objectives: [],
      attachments: [],
    });

    const questPath = (await apiPath(page, "getQuestById")).replace(
      ":id",
      String(questId),
    );
    const readDueAt = async () =>
      page.evaluate(async (url) => {
        const res = await fetch(url, { credentials: "include" });
        return ((await res.json()) as { dueAt?: string | null }).dueAt ?? null;
      }, questPath);

    // The 15th of whichever month the calendar opens on. A day number rather
    // than a computed date because the picker's cells are numbers, and 15 is
    // the one that cannot also appear as a neighbouring month's spill-over.
    const day = 15;

    await page.goto(`/${projectSlug}/quests/${shortId}`);
    await page.getByRole("button", { name: /edit/i }).first().click();
    await openAdvanced(page);

    await test.step("picking a day stores that day, ending at its end", async () => {
      const picker = page.getByRole("button", { name: /pick a date|due/i });
      await expect(picker.first()).toBeVisible({ timeout: 15_000 });
      await picker.first().click();

      // The calendar opens on the current month when the field is empty.
      const month = new Date().getMonth();
      await page.getByText(String(day), { exact: true }).first().click();
      await page
        .getByRole("button", { name: /save|update/i })
        .first()
        .click();

      await expect.poll(readDueAt, { timeout: 15_000 }).not.toBeNull();

      const local = new Date((await readDueAt()) as string);
      // The DAY has to survive, which is what `toISOString()` on a date-only
      // value would break west of UTC. Read back in LOCAL time, because that
      // is the timezone the day was chosen in.
      expect(local.getDate()).toBe(day);
      expect(local.getMonth()).toBe(month);
      // And it lands at the END of that day, which is what keeps a quest due
      // today from reading as overdue in the morning.
      expect(local.getHours()).toBe(23);
    });

    await test.step("clearing it actually clears it", async () => {
      await page.reload();
      await page.getByRole("button", { name: /edit/i }).first().click();
      const clear = page.getByRole("button", { name: /clear date/i }).first();
      await expect(clear).toBeVisible({ timeout: 15_000 });
      await clear.click();
      await page
        .getByRole("button", { name: /save|update/i })
        .first()
        .click();

      // ⚠️ Against the API, not the form. `undefined` is dropped by the ORM
      // update layer, so a form that looks empty can leave the old deadline
      // in the database.
      await expect.poll(readDueAt, { timeout: 15_000 }).toBeNull();
    });
  });

  /**
   * #1571. The commit trail already worked; it rendered the sha as dead text,
   * because `questCommitSchema` said outright that "Lore does not know a
   * project's repository and should not pretend to". Giving the project one
   * URL removes that premise.
   *
   * One project is one repository (2026-08-29), so this is a single field on
   * the project rather than a slug plus a provider setting - and the link is
   * built from the project, never from the per-commit `repo`, which stays
   * stored for the rows that already carry it.
   */
  test("a quest's commit links into the project repository once one is set", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    const projectTitle = `RU${t}`.slice(0, 20);
    const sha = "ded61fa6c0ffee1234567890abcdef1234567890";

    await registerAndVerify(page, `repourl${t}@example.com`, "RepoUrl123!");
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const { id: questId, shortId } = await apiPost<{
      id: number;
      shortId: number;
    }>(page, "createQuest", {
      projectId,
      title: `Shipped something ${t}`,
      description: "<p>x</p>",
      area: "Main",
      priority: "low",
      objectives: [],
      attachments: [],
    });
    // `apiPost` resolves an action by NAME and does not substitute params,
    // so a `:id` route is posted to by hand.
    const commitPath = (await apiPath(page, "addQuestCommit")).replace(
      ":id",
      String(questId),
    );
    await page.evaluate(
      async ({ url, body }) => {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      },
      { url: commitPath, body: { sha, message: "feat: the thing" } },
    );

    const questUrl = `/${projectSlug}/quests/${shortId}`;
    const commit = page.getByText(sha.slice(0, 7)).first();

    await test.step("plain text while the project has no repository", async () => {
      await page.goto(questUrl);
      await expect(commit).toBeVisible({ timeout: 15_000 });
      // A row that looks clickable and is not is worse than one that does
      // not, so the absence of the anchor is the assertion.
      await expect(page.locator(`a[href*="/commit/${sha}"]`)).toHaveCount(0);
    });

    await test.step("a link once the owner sets one", async () => {
      await page.goto(`/${projectSlug}/settings/`);
      const field = page.getByPlaceholder("https://github.com/you/your-repo");
      await expect(field).toBeVisible({ timeout: 15_000 });
      // With a trailing slash, which the schema strips: the rail appends a
      // path and must not have to guess whether there is already one.
      await field.fill("https://github.com/alepha-dev/alepha/");
      // The form is `disabledIfPristine`, so the button only becomes live
      // once the field is dirty - waiting on that is also the assertion that
      // the fill registered.
      // The form is `disabledIfPristine`, so waiting for the button to go
      // live is also the assertion that the fill registered.
      const save = page
        .getByRole("button", { name: /save|enregistrer/i })
        .first();
      await expect(save).toBeEnabled({ timeout: 10_000 });

      await save.click();

      // ⚠️ Poll the API until the value is actually stored, rather than
      // waiting on the button or on a response. The button is disabled while
      // the request is in flight, so `toBeDisabled` is satisfied a beat early;
      // and every call in this app is batched through one `/api/_batch` POST,
      // so a `waitForResponse` keyed on the method matches an unrelated batch.
      // Navigating on either one cancels the save mid-request.
      const slugPath = (await apiPath(page, "getProjectBySlug")).replace(
        ":slug",
        projectSlug,
      );
      await expect
        .poll(
          async () =>
            page.evaluate(async (url) => {
              const res = await fetch(url, { credentials: "include" });
              if (!res.ok) return null;
              return ((await res.json()) as { repositoryUrl?: string })
                .repositoryUrl;
            }, slugPath),
          { timeout: 15_000 },
        )
        .toBe("https://github.com/alepha-dev/alepha");

      await page.goto(questUrl);
      await expect(
        page.locator(
          `a[href="https://github.com/alepha-dev/alepha/commit/${sha}"]`,
        ),
      ).toBeVisible({ timeout: 15_000 });
    });
  });

  /**
   * #1323, from feedback #2009. Areas are named by import path, so the prefix
   * is the meaningful unit: "everything under lore/" took one pick per area.
   *
   * ⚠️ The row resolves to the individual areas rather than carrying a
   * pattern, so the assertion is on the CHIPS, not on the row. That is the
   * design decision: what is filtered is exactly what is shown.
   */
  test("typing a prefix in the area filter selects every area under it", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    const projectTitle = `AP${t}`.slice(0, 20);
    const areas = ["lore/quests", "lore/folios", "lore/ui", "alepha/orm"];

    await registerAndVerify(page, `areapfx${t}@example.com`, "AreaPfx123!");
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    for (const [index, area] of areas.entries()) {
      await apiPost(page, "createQuest", {
        projectId,
        title: `Area probe ${index} ${t}`,
        description: "<p>x</p>",
        area,
        priority: "low",
        objectives: [],
        attachments: [],
      });
    }

    await page.goto(`/${projectSlug}/quests`);
    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 15_000,
    });

    // Two steps now, where the chips box was one: the trigger opens the
    // popup, and the search field lives INSIDE it. The areas filter passes
    // `searchable` explicitly so this field exists at any option count -
    // without it there is no way to type a prefix and the row below never
    // appears.
    const filter = page
      .getByRole("combobox")
      .filter({ hasText: "All areas" })
      .first();
    await expect(filter).toBeVisible({ timeout: 15_000 });
    await filter.click();
    await page.getByPlaceholder("Search…").fill("lore/");

    // One row, standing for the three matches. It only appears when it would
    // do something: two or more unselected matches.
    await page.getByRole("option", { name: /select 3 matching/i }).click();
    await page.keyboard.press("Escape");

    // THREE values were added, not one "lore/" pattern - which is the whole
    // point of the row: it resolves to the individual areas. The trigger's
    // collapsed count is what proves the number now.
    //
    // This used to assert a chip per area. That check cannot survive the
    // chips box being replaced by a value-then-count trigger, and it must not
    // simply be pointed at the same text: `lore/quests` and its two siblings
    // are also printed in the table's own Area column, so a `getByText` would
    // go green whether the filter held three values, one, or a pattern.
    await expect(
      page.getByRole("combobox").filter({ hasText: "3 areas" }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // And the table narrowed to the three, leaving the alepha/orm quest out.
    await expect
      .poll(async () => page.locator("tbody tr").count(), { timeout: 15_000 })
      .toBe(3);
  });

  /**
   * #1324, from feedback #2010. The row menu offered two lifecycle moves and
   * a destructive one, and nothing for the two things done most often from a
   * list: pasting a quest's reference somewhere, and nudging a field.
   *
   * ⚠️ The clipboard assertion reads the real clipboard through
   * `navigator.clipboard.readText`, which needs the permission granted on the
   * context. Asserting the toast alone would pass on a handler that copied
   * the wrong string.
   */
  test("copy id and edit from the quests table row actions", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    const projectTitle = `RA${t}`.slice(0, 20);
    const questTitle = `RowActions${t}`;

    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await registerAndVerify(page, `rowact${t}@example.com`, "RowAct123!");
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const { shortId } = await apiPost<{ shortId: number }>(
      page,
      "createQuest",
      {
        projectId,
        title: questTitle,
        description: "Seeded for the row actions",
        area: "Main",
        priority: "low",
        objectives: [],
        attachments: [],
      },
    );

    await page.goto(`/${projectSlug}/quests`);
    await expect(page.getByText(questTitle).first()).toBeVisible({
      timeout: 15_000,
    });

    await test.step("Copy ID puts the #N reference on the clipboard", async () => {
      await page.getByRole("button", { name: "Open row actions" }).click();
      await page.getByRole("menuitem", { name: /copy id/i }).click();

      const copied = await page.evaluate(() => navigator.clipboard.readText());
      // The `#N` reference, not the row id: that is what pastes usefully into
      // a commit message, a prompt or a folio.
      expect(copied).toBe(`#${shortId}`);
    });

    await test.step("Edit opens the drawer and saves in place", async () => {
      await page.getByRole("button", { name: "Open row actions" }).click();
      await page.getByRole("menuitem", { name: /edit quest/i }).click();

      const renamed = `${questTitle}Edited`;
      const title = page.getByRole("textbox", { name: /name/i }).first();
      await expect(title).toBeVisible({ timeout: 10_000 });
      await title.fill(renamed);
      await page
        .getByRole("button", { name: /save|update/i })
        .first()
        .click();

      // The table refetches off `refreshSignal`, so the row shows the new
      // title without a navigation - which is the whole point of the entry.
      await expect(page.getByText(renamed).first()).toBeVisible({
        timeout: 15_000,
      });
      // Still on the list, which is `/quests` since Activity took the root.
      // The assertion is "no navigation happened", so the path it names has
      // to be the one the step started on.
      await expect(page).toHaveURL(new RegExp(`/${projectSlug}/quests$`));
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

    await page.goto(`/${projectSlug}/quests`);
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
      // See the note in "Shelved filter brings it back": a button trigger
      // showing `clearLabel`, not a chips input with a placeholder.
      await page
        .getByRole("combobox")
        .filter({ hasText: "All status" })
        .first()
        .click();
      await page.getByRole("option", { name: "Shelved" }).click();
      // A multi-select does NOT close on pick - the point is to take several
      // - so the popup would sit over the table for the row-action click
      // below. Single-select used to close itself.
      await page.keyboard.press("Escape");
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

/**
 * The Size column, hidden by default and turned on from the picker.
 *
 * ⚠️ The sort assertion is the point. `size` is an INTEGER column, so SQL
 * orders it correctly; sorting the rendered label instead would give
 * L, M, S, XL, XS. That is not hypothetical - it is what `priority` does
 * when sorted as text, and why `optional` sat above `high` on the kanban
 * board for its whole life.
 *
 * Sizes are seeded 3, 1, 5 so the two orderings disagree: by integer the
 * labels come out XS, M, XL, and as text they would be M, XL, XS.
 */
test.describe("Quest table — the Size column", () => {
  test("toggles on from the picker and sorts on the integer", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `qsize${t}@example.com`, "GoodPassw0rd");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `Qs${t}`.slice(0, 20),
    );

    for (const size of [3, 1, 5]) {
      await apiPost(page, "createQuest", {
        projectId,
        title: `Size${size}-${t}`,
        description: "",
        area: "lore/quests",
        priority: "medium",
        size,
        objectives: [],
        attachments: [],
      });
    }

    await page.goto(`/${slug}/quests`);
    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 15_000,
    });

    // Hidden by default: the table is already wide, and this column has had
    // no reader at all since `size` replaced `difficulty`.
    await expect(
      page.locator("thead").getByRole("button", { name: "Size" }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Toggle columns" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Size" }).click();
    await page.keyboard.press("Escape");

    const header = page.locator("thead").getByRole("button", { name: "Size" });
    await expect(header).toBeVisible({ timeout: 10_000 });

    const sizeColumn = async () =>
      await page
        .locator("tbody tr")
        .evaluateAll((rows) =>
          rows
            .map((row) =>
              [...row.querySelectorAll("td")]
                .map((td) => td.textContent?.trim() ?? "")
                .find((text) => ["XS", "S", "M", "L", "XL"].includes(text)),
            )
            .filter(Boolean),
        );

    await header.click();
    await expect
      .poll(sizeColumn, { timeout: 15_000 })
      .toEqual(["XS", "M", "XL"]);

    await header.click();
    await expect
      .poll(sizeColumn, { timeout: 15_000 })
      .toEqual(["XL", "M", "XS"]);
  });
});

/**
 * The standalone questline route (`/quests/:shortId/graph`), quest #1336.
 *
 * It used to be a page of its own design - a left rail plus a
 * PREVIOUS / current / NEXT window - over a client-side walk of an edge list
 * it re-fetched for the whole project every minute. It draws the same
 * `Questline` map the epic's Flow tab does now, and for a quest that HAS an
 * epic it does not draw at all: it sends the reader to that epic's Flow tab,
 * where the same map already lives beside the epic's own chrome.
 *
 * The fork is what only an e2e can check, because it is decided by the loader
 * against a real response and resolves before anything paints.
 */
test.describe("Quest — the questline route", () => {
  test("draws a component, and defers to the epic when there is one", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `qline${t}@example.com`, "GoodPassw0rd");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `Ql${t}`.slice(0, 20),
    );
    await setProjectFeature(page, projectId, "epics", true);

    const seed = async (title: string, dependsOn?: number) =>
      await apiPost<{ id: number; shortId: number }>(page, "createQuest", {
        projectId,
        title,
        description: "Seeded for the questline route",
        area: "orm",
        priority: "high",
        objectives: [],
        attachments: [],
        ...(dependsOn != null ? { dependsOn } : {}),
      });

    const root = await seed(`Root${t}`);
    const next = await seed(`Next${t}`, root.id);
    const alone = await seed(`Alone${t}`);

    const card = (quest: { shortId: number }, title: string) =>
      page.getByRole("button", { name: `#${quest.shortId} ${title}` });

    await test.step("an unfiled quest draws its own component", async () => {
      await page.goto(`/${slug}/quests/${root.shortId}/graph`);

      // Both of them, from either end of the edge: the walk is undirected, so
      // asking from the root has to reach what the root unblocks.
      await expect(card(root, `Root${t}`)).toBeVisible({ timeout: 15_000 });
      await expect(card(next, `Next${t}`)).toBeVisible();
      // And nothing else in the project.
      await expect(card(alone, `Alone${t}`)).toHaveCount(0);
    });

    await test.step("asking from the other end draws the same component", async () => {
      await page.goto(`/${slug}/quests/${next.shortId}/graph`);

      await expect(card(root, `Root${t}`)).toBeVisible({ timeout: 15_000 });
      await expect(card(next, `Next${t}`)).toBeVisible();
    });

    await test.step("a quest with no relations says so", async () => {
      await page.goto(`/${slug}/quests/${alone.shortId}/graph`);

      await expect(page.getByText(/depends on nothing/i)).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("a quest inside an epic goes to that epic's Flow tab", async () => {
      const epic = await page.evaluate(
        async ({ projectId, title }) => {
          const r = await fetch(`/api/createEpic/${projectId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ title }),
          });
          if (!r.ok) throw new Error(`createEpic ${r.status}`);
          return r.json() as Promise<{ id: number; number: number }>;
        },
        { projectId, title: `Ep${t}` },
      );

      await page.evaluate(
        async ({ epicId, questId }) => {
          const r = await fetch(`/api/attachQuest/${epicId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ questId }),
          });
          if (!r.ok) throw new Error(`attachQuest ${r.status}`);
        },
        { epicId: epic.id, questId: root.id },
      );

      await page.goto(`/${slug}/quests/${root.shortId}/graph`);

      // The redirect is a loader throw, so it resolves before anything of the
      // questline page paints - there is no frame where the reader sees one
      // surface on the way to the other.
      await expect(page).toHaveURL(
        new RegExp(`/epics/${epic.number}\\?tab=flow$`),
        { timeout: 15_000 },
      );
      await expect(card(root, `Root${t}`)).toBeVisible({ timeout: 15_000 });
    });
  });
});
