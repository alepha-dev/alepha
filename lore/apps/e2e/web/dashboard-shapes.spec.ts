import type { APIRequestContext, Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import {
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
  setCapability,
} from "./_helpers.ts";

/**
 * The computed board (#E77, #Q2664) for four project shapes built through
 * the API, and a capability switched live: the board follows on the next
 * visit, with nothing written.
 */

const send = async <T>(
  page: Page,
  method: "POST" | "GET",
  path: string,
  body?: unknown,
): Promise<T> =>
  (await page.evaluate(
    async ({ method, path, body }) => {
      const r = await fetch(
        path,
        method === "GET"
          ? { credentials: "include", cache: "no-store" }
          : {
              method,
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify(body ?? {}),
            },
      );
      if (!r.ok)
        throw new Error(`${method} ${path} ${r.status} ${await r.text()}`);
      return r.json();
    },
    { method, path, body },
  )) as T;

const createQuest = (page: Page, projectId: number, title: string) =>
  apiPost<{ id: number; shortId: number }>(page, "createQuest", {
    projectId,
    title,
    description: "",
    area: "Main",
    priority: "medium",
    objectives: [],
    attachments: [],
  });

/**
 * Slot and metric of every tile the board renders, in order.
 */
const tiles = async (page: Page, slug: string) => {
  await page.goto(`/${slug}`);
  await page.waitForLoadState("networkidle");
  return page
    .getByTestId("dashboard-card")
    .evaluateAll((cards) =>
      cards.map((card) => [
        card.getAttribute("data-slot"),
        card.getAttribute("data-metric"),
      ]),
    );
};

/**
 * An app copy with a sigil that has reported, so the apps slot's data gate
 * (an app heard from in 30 days) passes. Ingest goes through Playwright's
 * own `request`, never the page: the page's `fetch` attaches the session
 * bearer, which would replace the sigil token (see `apps.spec.ts`).
 */
const reportingApp = async (
  page: Page,
  request: APIRequestContext,
  projectId: number,
) => {
  await send(page, "POST", `/api/projects/${projectId}/apps`, {
    app: "web",
    env: "production",
  });
  const minted = await send<{ token: string }>(
    page,
    "POST",
    `/api/projects/${projectId}/sigils`,
    { app: "web", env: "production" },
  );
  const origin = new URL(page.url()).origin;
  const ingest = await request.post(`${origin}/sigils/ingest`, {
    headers: { Authorization: `Bearer ${minted.token}` },
    data: { environment: "production", host: "web.example.com", events: [] },
  });
  expect(ingest.ok()).toBe(true);
};

test.describe("Computed project board", () => {
  test("four project shapes, and Releases switched on live", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const t = Date.now();
    await registerAndVerify(page, `pshape${t}@example.com`, "GoodPassw0rd");

    await test.step("everything on: the release heads the board, plan and apps render", async () => {
      const { id, slug } = await createProjectViaWizard(
        page,
        `PSA${t}`.slice(0, 20),
        {
          capabilities: ["apps", "support"],
          options: { work: ["epics", "releases"], apps: ["track"] },
        },
      );
      const release = await send<{ id: number }>(
        page,
        "POST",
        `/api/createRelease/${id}`,
        { tag: "0.1.0" },
      );
      const quest = await createQuest(page, id, `Ship${t}`);
      await send(page, "POST", `/api/updateQuestById/${quest.id}`, {
        releaseId: release.id,
      });
      await send(page, "POST", `/api/createEpic/${id}`, { title: "Next up" });
      await reportingApp(page, request, id);

      const shown = await tiles(page, slug);
      expect(shown).toContainEqual(["headline", "releaseOutlook"]);
      expect(shown.some(([slot]) => slot === "plan")).toBe(true);
      expect(shown.some(([slot]) => slot === "apps")).toBe(true);
      await expect(page.getByTestId("dashboard-headline")).toContainText(
        "0.1.0",
      );
    });

    let workProject = { id: 0, slug: "" };
    await test.step("Work without epics or releases: no epic or release tile", async () => {
      workProject = await createProjectViaWizard(page, `PSB${t}`.slice(0, 20));
      await setCapability(page, workProject.id, "work", {
        options: { epics: false, releases: false },
      });
      await createQuest(page, workProject.id, `Plain${t}`);

      const shown = await tiles(page, workProject.slug);
      expect(
        shown.filter(([, metric]) => /epic|release/i.test(metric ?? "")),
      ).toEqual([]);
    });

    await test.step("Knowledge only: pinned and recent folios, no Work tile", async () => {
      const { id, slug } = await createProjectViaWizard(
        page,
        `PSC${t}`.slice(0, 20),
      );
      await setCapability(page, id, "work", { enabled: false });
      await apiPost(page, "create", {
        title: "Welcome",
        content: "Start here.",
        projectId: id,
      });

      const shown = await tiles(page, slug);
      expect(shown).toContainEqual(["headline", "recentFolios"]);
      expect(
        shown.some(([, metric]) =>
          /quest|epic|release|needsYou|completed/i.test(metric ?? ""),
        ),
      ).toBe(false);
    });

    await test.step("Apps on with no sigil: no apps slot", async () => {
      const { id, slug } = await createProjectViaWizard(
        page,
        `PSD${t}`.slice(0, 20),
        { capabilities: ["apps"], options: { apps: ["track"] } },
      );
      await createQuest(page, id, `Solo${t}`);

      const shown = await tiles(page, slug);
      expect(shown.some(([slot]) => slot === "apps")).toBe(false);
    });

    await test.step("turning Releases on changes the board on the next visit, writing nothing", async () => {
      await setCapability(page, workProject.id, "work", {
        options: { releases: true },
      });
      const release = await send<{ id: number }>(
        page,
        "POST",
        `/api/createRelease/${workProject.id}`,
        { tag: "1.0.0" },
      );
      const quest = await createQuest(page, workProject.id, `Due${t}`);
      await send(page, "POST", `/api/updateQuestById/${quest.id}`, {
        releaseId: release.id,
      });

      const shown = await tiles(page, workProject.slug);
      expect(shown[0]).toEqual(["headline", "releaseOutlook"]);

      const stored = await send<{ cards: unknown[] }>(
        page,
        "GET",
        `/api/projects/${workProject.id}/dashboard/cards`,
      );
      expect(stored.cards).toEqual([]);
    });
  });
});
