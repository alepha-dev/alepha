import { expect, test } from "@playwright/test";
import {
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * Milestones feature e2e: the ledger page. Quests are seeded and driven
 * through the API — their own lifecycle is covered by `quest.spec.ts` — so
 * this spec can focus on what the Milestones page itself claims:
 *
 *   empty banner → start → hero + LIVE changelog → close → FROZEN.
 *
 * The page's whole point is the recording/frozen distinction, so that is
 * what gets asserted rather than the mere presence of a heading.
 */
test.describe("Milestones", () => {
  test("start → record a quest → close → frozen changelog", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    const email = `milestone${t}@example.com`;
    const password = "MilestoneTest123!";
    const projectTitle = `MC${t}`.slice(0, 20);

    await registerAndVerify(page, email, password);
    const projectId = await createProjectViaWizard(page, projectTitle);

    await test.step("empty state names what is not being recorded", async () => {
      await page.goto(`/p/${projectId}/milestones`);
      await page.waitForLoadState("networkidle");

      await expect(
        page.getByRole("heading", { name: /nothing is recording/i }),
      ).toBeVisible({ timeout: 15_000 });
      // No milestone has ever closed, so the auto-close hint is the manual
      // default and the "Still open" rail is empty.
      await expect(page.getByText(/auto-close:/i)).toBeVisible();
    });

    const startedTitle = `Release${t}`;

    await test.step("start a milestone", async () => {
      await page.getByRole("button", { name: /start milestone/i }).click();

      const dialog = page.getByRole("dialog");
      const titleInput = dialog.getByRole("textbox").first();
      await expect(titleInput).toBeVisible({ timeout: 10_000 });
      await titleInput.fill(startedTitle);

      // The dialog's own submit, not the banner button behind it.
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /start milestone/i })
        .click();

      await expect(
        page.getByRole("heading", { name: startedTitle }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/recording/i).first()).toBeVisible();
    });

    const questTitle = `Recorded${t}`;

    await test.step("a completed quest lands in the live changelog", async () => {
      const { id: questId } = await apiPost<{ id: number }>(
        page,
        "createQuest",
        {
          projectId,
          title: questTitle,
          description: "Seeded for the milestone changelog",
          zone: "orm",
          priority: "high",
          difficulty: 2,
          objectives: [],
          attachments: [],
        },
      );
      // `acceptQuest` has no body schema, so it is GET at the canonical
      // /api/acceptQuest/:id — same shape quest.spec.ts drives.
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
      }, questId);

      await page.reload();
      await page.waitForLoadState("networkidle");

      // Zone heading + the quest row, under a LIVE pill.
      await expect(page.getByText(/LIVE ·/).first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText(questTitle).first()).toBeVisible();
      await expect(page.getByText("orm").first()).toBeVisible();
    });

    await test.step("close the milestone and freeze the changelog", async () => {
      await page.getByRole("button", { name: /close milestone/i }).click();

      await page
        .getByRole("dialog")
        .getByRole("button", { name: /close milestone|confirm|seal/i })
        .first()
        .click();

      // The hero is replaced by the empty banner, and the changelog the page
      // falls back to is the one just frozen.
      await expect(page.getByText(/FROZEN/).first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText(questTitle).first()).toBeVisible();

      // The closed milestone now appears in the Released rail.
      await expect(page.getByText(startedTitle).first()).toBeVisible();
    });

    await test.step("save the frozen changelog to Folios", async () => {
      await page.getByRole("button", { name: /save to folios/i }).click();

      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByRole("heading", { name: /save changelog to folios/i }),
      ).toBeVisible({ timeout: 10_000 });

      // The dialog closing is not proof of a save — `handleSaveToFolio`
      // leaves it open on failure — so wait for the button to be actionable
      // and then assert the folio itself, not the dialog's disappearance.
      const save = dialog.getByRole("button", { name: /^save$/i });
      await expect(save).toBeEnabled({ timeout: 10_000 });
      await save.click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });

      // The folio lands in the project root, titled after the milestone.
      await page.goto(`/p/${projectId}/folios`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(/Milestone #1 —/).first()).toBeVisible({
        timeout: 15_000,
      });
    });
  });
});
