import * as fs from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
  apiPath,
  apiPost,
  clearEmails,
  createCampaignViaWizard,
  emailDir,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * Petition end-to-end:
 *
 * 1. Owner registers, creates a public campaign, seeds a zone.
 * 2. Owner lands on `/c/:id/request?path=…&type=bug`, fills + submits the
 *    form, ends up on the petition status page.
 * 3. Status page shows `pending`, no linked quests.
 * 4. Owner accepts the petition via API and creates two quests linked to it
 *    (also via API — keeps the test focused on the petition <-> quest
 *    plumbing, not on the existing quest UI which is covered in quest.spec.ts).
 * 5. Owner marks one quest accepted then completed.
 * 6. Owner opens the status page, sees `accepted` petition with two linked
 *    quests in the expected states (`completed` + `new`).
 *
 * Other features (quest lifecycle, campaign settings, etc.) live in their
 * own spec files. See apps/lore/CLAUDE.md for the convention.
 */

const apiPostParams = async <T>(
  page: Page,
  action: string,
  params: Record<string, string>,
  body?: unknown,
): Promise<T> => {
  let url = await apiPath(page, action);
  for (const [k, v] of Object.entries(params)) {
    url = url.replace(`:${k}`, v);
  }
  return (await page.evaluate(
    async ({ url, body }) => {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) {
        throw new Error(`${r.status} ${await r.text()}`);
      }
      return r.json();
    },
    { url, body },
  )) as T;
};

test.describe("Petition", () => {
  test.beforeAll(() => {
    fs.mkdirSync(emailDir, { recursive: true });
    clearEmails();
  });

  // We exercise the full petition lifecycle as a single user — the campaign
  // owner who also submits the petition. `getMine` permits both roles on the
  // same petition, so the data model (1 petition → N quests, statuses
  // surfaced) is fully covered. Cross-user visibility belongs in a unit test
  // on the controller, not Playwright.
  test("submit, accept, link quests, see progression", async ({ page }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    const email = `petitioner${t}@example.com`;
    const password = "PetitionTest123!";
    const campaignTitle = `Pet${t}`.slice(0, 20);
    const petitionTitle = `Bug${t}`;
    const petitionDescription = `Repro:\n1. step one\n2. step two\nExpected: works\nActual: explodes`;
    const reportPath = "/checkout";
    const reportUrl = `https://customer-site.example.com${reportPath}`;

    await registerAndVerify(page, email, password);
    const campaignId = await createCampaignViaWizard(page, campaignTitle);

    await test.step("seed a zone via createQuest", async () => {
      await apiPost(page, "createQuest", {
        campaignId,
        title: `Seed${t}`,
        description: "Seed quest so zone 'Triage' exists",
        zone: "Triage",
        priority: "medium",
        difficulty: 2,
        objectives: [],
        attachments: [],
      });
    });

    // ── Submit a petition through the UI request form ────────────────────────
    let petitionId = 0;
    await test.step("submit petition via the request form", async () => {
      // Land on the request URL with autofill query params the way an external
      // `<a target="_blank">` from a customer site would deliver them.
      await page.goto(
        `/c/${campaignId}/request?path=${encodeURIComponent(
          reportPath,
        )}&url=${encodeURIComponent(reportUrl)}&type=bug`,
      );
      await page.waitForLoadState("networkidle");

      // Control wraps inputs without exposing the label as an aria-name —
      // title is the only text input on this form, description the only
      // textarea.
      await page.locator('input[type="text"]').first().fill(petitionTitle);
      await page.locator("textarea").first().fill(petitionDescription);

      await page.getByRole("button", { name: /^submit petition$/i }).click();

      // Successful submit redirects to /c/:id/p/:pid (the reporter status
      // page).
      await page.waitForURL(/\/c\/\d+\/p\/\d+/, { timeout: 15_000 });
      petitionId = Number(page.url().match(/\/p\/(\d+)/)![1]);
      expect(petitionId).toBeGreaterThan(0);
    });

    await test.step("status page shows pending, no quests yet", async () => {
      await expect(page.getByTestId("petition-status-badge")).toContainText(
        /pending/i,
        { timeout: 10_000 },
      );
      await expect(page.getByTestId("petition-status-pending")).toBeVisible();
    });

    // ── Accept the petition + create 2 quests linked to it (API) ─────────────
    await test.step("accept the petition (API)", async () => {
      await apiPostParams(page, "acceptPetition", {
        campaignId: String(campaignId),
        petitionId: String(petitionId),
      });
    });

    const linkedQuestIds: number[] = [];
    await test.step("create two quests linked to the petition", async () => {
      for (const i of [1, 2]) {
        const { id } = await apiPost<{ id: number }>(page, "createQuest", {
          campaignId,
          title: `${petitionTitle} - part ${i}`,
          description: `<p>Work item ${i} from the petition.</p>`,
          zone: "Triage",
          priority: "medium",
          difficulty: 2,
          objectives: [],
          attachments: [],
          petitionId,
        });
        expect(id).toBeGreaterThan(0);
        linkedQuestIds.push(id);
      }
      expect(linkedQuestIds).toHaveLength(2);
    });

    await test.step("accept then complete the first quest", async () => {
      const [firstQuestId] = linkedQuestIds;
      // QuestController.acceptQuest has no body schema, so $action infers GET.
      // completeQuest now takes an optional `message` body, so it's POST.
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
      }, firstQuestId);
    });

    // ── Reporter view: petition accepted, both quests visible with status ────
    await test.step("status page shows accepted petition with 2 linked quests", async () => {
      await page.goto(`/c/${campaignId}/p/${petitionId}`);
      await page.waitForLoadState("networkidle");

      await expect(page.getByTestId("petition-status-badge")).toContainText(
        /accepted/i,
        { timeout: 15_000 },
      );

      const linkedSection = page.getByTestId("petition-status-linked-quests");
      await expect(linkedSection).toBeVisible();

      const [firstId, secondId] = linkedQuestIds;
      const firstRow = page.getByTestId(`petition-quest-${firstId}`);
      const secondRow = page.getByTestId(`petition-quest-${secondId}`);

      await expect(firstRow).toBeVisible();
      await expect(secondRow).toBeVisible();

      // Status attribute is the easiest assertion target — an enum stamp,
      // not a localized label.
      await expect(firstRow).toHaveAttribute("data-quest-status", "completed");
      await expect(secondRow).toHaveAttribute("data-quest-status", "new");
    });
  });
});
