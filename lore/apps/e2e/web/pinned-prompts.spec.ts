import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import {
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
  releasePointerEvents,
} from "./_helpers.ts";

/**
 * Prompts pinned to pages (#E174, #Q4284): a new project shows no robot
 * button; Work on quest pinned on the Quest view from Settings > Prompts
 * copies in one click from the view and from a quest's row, and is gone
 * from a completed quest; Review Epic pinned on the Quest view asks for its
 * epic; the spotlight copies a prompt pinned nowhere.
 *
 * ⚠️ Every `$action` the SPA calls goes through `POST /api/_batch`: the
 * assertions are on rendered state and on the clipboard.
 */
const post = async (page: Page, url: string, body: unknown, method = "POST") =>
  page.evaluate(
    async ({ url, body, method }) => {
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`${url} ${r.status} ${await r.text()}`);
      return r.json();
    },
    { url, body, method },
  );

test.describe("Pinned prompts", () => {
  test("pin, copy from a view and a row, hidden on a completed quest, an arg asked, and the spotlight", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    const t = Date.now();
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await registerAndVerify(page, `pins-${t}@example.com`, "GoodPassw0rd");
    const project = await createProjectViaWizard(page, "Pins Walk", {
      capabilities: ["prompts"],
      options: { plan: ["epics"] },
    });
    const quest = async (title: string) =>
      apiPost<{ id: string; shortId: number }>(page, "createQuest", {
        projectId: project.id,
        title,
        description: title,
        area: "Main",
        priority: "low",
        objectives: [],
        attachments: [],
      });
    const open = await quest(`Fix the cart ${t}`);
    const done = await quest(`Ship the login ${t}`);
    await post(page, `/api/acceptQuest/${done.id}`, {});
    await post(page, `/api/completeQuest/${done.id}`, {});
    const epic = (await post(page, `/api/createEpic/${project.id}`, {
      title: `The plan ${t}`,
    })) as { number: number };
    const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
    const robot = () => page.getByTestId("pinned-prompts");

    await test.step("a new project has no robot button", async () => {
      await page.goto(`/${project.slug}/quests/${open.shortId}`);
      await expect(page.getByText(`Fix the cart ${t}`).first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(robot()).toHaveCount(0);
    });

    await test.step("Work on quest is pinned on the Quest view from Settings", async () => {
      await page.goto(`/${project.slug}/settings/prompts`);
      const row = page.locator("tbody tr", {
        has: page.getByTestId("prompt-title").getByText("Work on quest", {
          exact: true,
        }),
      });
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.getByRole("button", { name: /actions/i }).click();
      await page.getByRole("menuitem", { name: "Pin", exact: true }).click();
      const dialog = page.getByTestId("prompt-pins");
      // One multi select over the pages (#Q4300): pick, close the list,
      // save.
      await dialog.getByTestId("prompt-pins-pages").click();
      await page.getByRole("option", { name: "Quest view" }).click();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId("prompt-pins-pages")).toContainText(
        "Quest view",
      );
      await dialog.getByTestId("prompt-pins-save").click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      await releasePointerEvents(page);
      await expect(row.getByTestId("prompt-pins-cell")).toHaveText(
        "Quest view",
      );
    });

    await test.step("it copies in one click from the view, with the quest filled in", async () => {
      await page.goto(`/${project.slug}/quests/${open.shortId}`);
      await robot().click();
      await page.getByRole("menuitem", { name: "Work on quest" }).hover();
      await page.getByRole("menuitem", { name: "Copy", exact: true }).click();
      await expect
        .poll(clipboard, { timeout: 15_000 })
        .toContain(`#Q${open.shortId}`);
    });

    await test.step("and from a quest's row", async () => {
      await page.evaluate(() => navigator.clipboard.writeText(""));
      await page.goto(`/${project.slug}/quests`);
      const row = page.locator("tbody tr", {
        hasText: `Fix the cart ${t}`,
      });
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.getByRole("button", { name: /actions/i }).click();
      await page.getByRole("menuitem", { name: "Agent prompts" }).hover();
      await page
        .getByRole("menuitem", { name: "Copy: Work on quest", exact: true })
        .click();
      await expect
        .poll(clipboard, { timeout: 15_000 })
        .toContain(`#Q${open.shortId}`);
    });

    await test.step("a completed quest does not offer it", async () => {
      await page.goto(`/${project.slug}/quests/${done.shortId}`);
      await expect(page.getByText(`Ship the login ${t}`).first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(robot()).toHaveCount(0);
    });

    await test.step("Review Epic pinned on the Quest view asks for its epic", async () => {
      await post(
        page,
        `/api/projects/${project.id}/prompts/review-epic`,
        { pins: ["quest"] },
        "PATCH",
      );
      await page.evaluate(() => navigator.clipboard.writeText(""));
      await page.goto(`/${project.slug}/quests/${open.shortId}`);
      await robot().click();
      await page.getByRole("menuitem", { name: "Review Epic" }).hover();
      await page.getByRole("menuitem", { name: "Copy", exact: true }).click();
      const dialog = page.getByTestId("prompt-run-dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("combobox").first().click();
      await page
        .getByRole("option", { name: new RegExp(`The plan ${t}`) })
        .click();
      await dialog.getByTestId("prompt-run-submit").click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      await expect
        .poll(clipboard, { timeout: 15_000 })
        .toContain(`#E${epic.number}`);
    });

    await test.step("the spotlight copies a prompt pinned nowhere", async () => {
      await page.evaluate(() => navigator.clipboard.writeText(""));
      await page.keyboard.press("ControlOrMeta+k");
      await page
        .getByRole("combobox")
        .last()
        .fill("Copy prompt: Work on loose");
      await page
        .getByRole("option", { name: "Copy prompt: Work on loose quests" })
        .click();
      await expect.poll(clipboard, { timeout: 15_000 }).toContain(project.slug);
    });
  });
});
