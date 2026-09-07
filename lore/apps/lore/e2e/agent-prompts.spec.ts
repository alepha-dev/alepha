import { expect } from "@playwright/test";

import { test } from "./_fixtures.ts";
import {
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
  setCapability,
} from "./_helpers.ts";

/**
 * Agent prompts end to end: the switch, the four templates, and a copy from
 * each surface.
 *
 * ⚠️ **The OFF state is asserted first, because it is production's own
 * state.** The `agentPrompts` option is off by default and there is no
 * backfill, so on the day this ships every project including
 * `lore.alepha.dev` has no Agent Prompts menu until someone turns it on in
 * Settings > Work.
 *
 * ⚠️ **The switch is flipped and a prompt copied with no reload in
 * between**, and that is the point rather than a shortcut. The route loader
 * writes `{}` into `projectPromptsAtom` while the option is off, flipping
 * the switch does not re-run the loader, and `{}` from "off" is
 * indistinguishable from `{}` from "nothing customised". If the Settings
 * section's unconditional refetch is missing or wrong, this sequence is
 * what catches it, and only without a reload.
 *
 * It is also the backstop for the submenu: a jsdom spec cannot prove a
 * portalled `DropdownMenuSub` lays out, so the copies here are the proof
 * that a child entry is reachable and copies the right text. Do not trim
 * this suite on the grounds that the browser specs cover it.
 */
test.describe("agent prompts", () => {
  test("the switch, a custom template, a reset, and a copy from each surface", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    const projectTitle = `AP${t}`.slice(0, 20);

    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await registerAndVerify(page, `agentp${t}@example.com`, "AgentP123!");
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
      { options: { work: ["epics"] } },
    );

    // ⚠️ A direct URL rather than `apiPost`: `createEpic` and the feedback
    // submit both take the project as a PATH parameter, and `apiPath`
    // resolves an action to its declared path with `:projectId` still in
    // it and nowhere to put the value. Same reason `setCapability` uses one.
    const epic = await page.evaluate(
      async ({ projectId }) => {
        const r = await fetch(`/api/createEpic/${projectId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ title: "The plan" }),
        });
        if (!r.ok) throw new Error(`createEpic ${r.status} ${await r.text()}`);
        return r.json() as Promise<{ id: number; number: number }>;
      },
      { projectId },
    );
    // ⚠️ A stored template written while the option is still OFF. This is
    // the shape decision 20 is about: an owner whose project already has
    // customised rows, loading the app with the switch off. The write path
    // is owner-gated but not option-gated, so this is a legal state.
    await page.evaluate(
      async ({ projectId }) => {
        const r = await fetch(`/api/projects/${projectId}/prompts/epicReview`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            template: "Stored review of {{reference}} in {{project}}.",
          }),
        });
        if (!r.ok) throw new Error(`setPrompt ${r.status} ${await r.text()}`);
      },
      { projectId },
    );

    const quest = await apiPost<{ shortId: number }>(page, "createQuest", {
      projectId,
      title: `AgentQuest${t}`,
      description: "Seeded for the prompt menu",
      area: "Main",
      priority: "low",
      objectives: [],
      attachments: [],
    });

    await test.step("with the option off, no surface offers the menu", async () => {
      await page.goto(`/${projectSlug}/epics`);
      await expect(page.getByText("The plan").first()).toBeVisible({
        timeout: 15_000,
      });

      await page.getByRole("button", { name: "Open row actions" }).click();
      // Begin is there, so the menu opened and the absence below is real.
      await expect(
        page.getByRole("menuitem", { name: /begin/i }),
      ).toBeVisible();
      await expect(
        page.getByRole("menuitem", { name: /agent prompts/i }),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");

      await page.goto(`/${projectSlug}/epics/${epic.number}`);
      await expect(page.getByRole("button", { name: /^edit$/i })).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        page.getByRole("button", { name: /agent prompts/i }),
      ).toHaveCount(0);
    });

    await test.step("Settings > Work turns it on, by its own name", async () => {
      await page.goto(`/${projectSlug}/settings/work`);
      // ⚠️ Addressed by its own label, not by "Enable": only the capability
      // MASTER switch carries the generic name, and each option row sets
      // `aria-label` from its own label key.
      const toggle = page.getByRole("switch", { name: "Agent prompts" });
      await expect(toggle).toBeVisible({ timeout: 15_000 });

      // ⚠️ The capability switches are optimistic, so the control's own
      // state says nothing about what was stored. Wait for the write.
      const saved = page.waitForResponse(
        (r) =>
          r.url().includes(`/capabilities/work`) &&
          r.request().method() === "PUT",
      );
      await toggle.click();
      await saved;

      // The editors appear with it, seeded from the built-in defaults.
      await expect(page.getByTestId("prompt-input-epicReview")).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("the stored template is copied after the flip, with no page load", async () => {
      // The editor proves the section read the stored row rather than
      // seeding from the default.
      await expect(page.getByTestId("prompt-input-epicReview")).toHaveValue(
        "Stored review of {{reference}} in {{project}}.",
      );

      // ⚠️ A CLIENT-SIDE navigation through the sidebar, never
      // `page.goto`. Settings and Epics are both under the `project`
      // layout, so clicking through does not re-run its loader, which is
      // exactly the production path decision 20 describes: the loader wrote
      // `{}` while the option was off, and `{}` from "off" is
      // indistinguishable from `{}` from "nothing customised". A
      // `page.goto` here would reload the app and re-run the loader,
      // repairing the very state under test.
      await page
        .locator('[data-slot="sidebar"]')
        .getByRole("link", { name: "Epics" })
        .click();
      await expect(page).toHaveURL(new RegExp(`/${projectSlug}/epics$`));
      await expect(page.getByText("The plan").first()).toBeVisible({
        timeout: 15_000,
      });

      await page.getByRole("button", { name: "Open row actions" }).click();
      await page.getByRole("menuitem", { name: /agent prompts/i }).click();
      await page.getByRole("menuitem", { name: /^review$/i }).click();

      const copied = await page.evaluate(() => navigator.clipboard.readText());
      // The STORED template, rendered. Without the Settings section's
      // unconditional refetch this is the built-in default instead, which
      // is the silent failure the whole arrangement exists to prevent.
      expect(copied).toBe(
        `Stored review of #E${epic.number} in ${projectTitle}.`,
      );
      // ⚠️ `{{project}}` is the project's TITLE, which is what
      // `project_name` matches over MCP, and never its slug.
      expect(copied).toContain(projectTitle);
      expect(copied).not.toContain("{{");
    });

    await test.step("editing and saving a template takes effect too", async () => {
      await page.goto(`/${projectSlug}/settings/work`);
      const editor = page.getByTestId("prompt-input-epicReview");
      await expect(editor).toBeVisible({ timeout: 15_000 });
      await editor.fill("Edited review of {{reference}}.");

      const saved = page.waitForResponse(
        (r) =>
          r.url().includes("/prompts/epicReview") &&
          r.request().method() === "PUT",
      );
      await page.getByRole("button", { name: "Save" }).first().click();
      await saved;

      await page
        .locator('[data-slot="sidebar"]')
        .getByRole("link", { name: "Epics" })
        .click();
      await page.getByRole("button", { name: "Open row actions" }).click();
      await page.getByRole("menuitem", { name: /agent prompts/i }).click();
      await page.getByRole("menuitem", { name: /^review$/i }).click();

      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toBe(`Edited review of #E${epic.number}.`);
    });

    await test.step("Activate is offered beside Review while the epic is planned", async () => {
      await page.getByRole("button", { name: "Open row actions" }).click();
      await page.getByRole("menuitem", { name: /agent prompts/i }).click();
      await page.getByRole("menuitem", { name: /^activate$/i }).click();

      const copied = await page.evaluate(() => navigator.clipboard.readText());
      // Activate's own default, not Review's.
      expect(copied).toContain("to completion, quest by quest");
      expect(copied).toContain(`#E${epic.number}`);
    });

    await test.step("Reset restores the built-in default", async () => {
      await page.goto(`/${projectSlug}/settings/work`);
      await expect(page.getByTestId("prompt-reset-epicReview")).toBeVisible({
        timeout: 15_000,
      });

      const reset = page.waitForResponse(
        (r) =>
          r.url().includes("/prompts/epicReview") &&
          r.request().method() === "DELETE",
      );
      await page.getByTestId("prompt-reset-epicReview").click();
      await page
        .getByRole("button", { name: /reset to default/i })
        .last()
        .click();
      await reset;

      await page.goto(`/${projectSlug}/epics`);
      await page.getByRole("button", { name: "Open row actions" }).click();
      await page.getByRole("menuitem", { name: /agent prompts/i }).click();
      await page.getByRole("menuitem", { name: /^review$/i }).click();

      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toContain("Review the plan of epic");
      expect(copied).not.toContain("Edited review of");
    });

    await test.step("a quest copies its own prompt", async () => {
      await page.goto(`/${projectSlug}/quests`);
      await expect(page.getByText(`AgentQuest${t}`).first()).toBeVisible({
        timeout: 15_000,
      });

      await page
        .getByRole("button", { name: "Open row actions" })
        .first()
        .click();
      await page.getByRole("menuitem", { name: /agent prompts/i }).click();
      await page.getByRole("menuitem", { name: /work on it/i }).click();

      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toContain("Work on quest");
      expect(copied).toContain(`#Q${quest.shortId}`);
      // `quest_get` takes the per-project shortId, never the global id.
      expect(copied).toContain(`shortId ${quest.shortId}`);
    });

    await test.step("a feedback item copies a prompt referencing #P", async () => {
      // The wizard leaves Support off, and the panel exists only under it:
      // the menu reads Work's option to narrow what it offers, and Support
      // to exist at all.
      await setCapability(page, projectId, "support");

      const feedback = await page.evaluate(
        async ({ projectId, title }) => {
          const r = await fetch(`/api/projects/${projectId}/feedback`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              title,
              description: "Seeded for the prompt menu",
              type: "bug",
            }),
          });
          if (!r.ok) throw new Error(`feedback ${r.status} ${await r.text()}`);
          // ⚠️ `submitFeedback` answers `{ id }` only, never the shortId, so
          // the reference below is matched by SHAPE rather than pinned to a
          // number this test never learns.
          return r.json() as Promise<{ id: number }>;
        },
        { projectId, title: `AgentFeedback${t}` },
      );

      await page.goto(`/${projectSlug}/feedback`);
      await expect(page.getByText(`AgentFeedback${t}`).first()).toBeVisible({
        timeout: 15_000,
      });

      await page.getByRole("button", { name: /agent prompts/i }).click();
      await page.getByRole("menuitem", { name: /work on it/i }).click();

      const copied = await page.evaluate(() => navigator.clipboard.readText());
      // ⚠️ `P` is feedback's letter; `F` is the folio's. A prompt saying
      // `#F<n>` sends the agent to a folio.
      expect(copied).toMatch(/#P\d+/);
      expect(copied).not.toMatch(/#F\d+/);
      // The title is there too, so the reference above belongs to THIS
      // report rather than to whatever the panel happened to have open.
      expect(copied).toContain(`AgentFeedback${t}`);
      // The inbox, because no URL opens one report.
      expect(copied).toContain("The inbox:");
      expect(feedback.id).toBeGreaterThan(0);
    });
  });
});
