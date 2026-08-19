import { expect, test } from "@playwright/test";
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
      // No `networkidle` here: the Epic page embeds the dependency flow, which
      // polls every 60s, so the network is never idle and the wait can only
      // time out. The visibility assertions below carry their own timeouts.
      await page.goto(`/${slug}/epics/${epic.number}`);

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
      // No `networkidle` here: the Epic page embeds the dependency flow, which
      // polls every 60s, so the network is never idle and the wait can only
      // time out. The visibility assertions below carry their own timeouts.
      await page.goto(`/${slug}/epics/${epic.number}`);

      await expect(page.getByText(gatedTitle).first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText(releasedTitle).first()).toBeVisible();
    });
  });
});
