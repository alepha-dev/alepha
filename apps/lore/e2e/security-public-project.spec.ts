import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  createProjectViaWizard,
  newUserContext,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * Regression coverage for the project-membership gate.
 *
 * After the public-project purge there is no non-member visibility
 * path — every project endpoint is `assertMember`-gated. A separate
 * logged-in account who hasn't been invited must hit 403 on reads AND
 * writes against another user's project.
 *
 * (The kanban public-share use case is gone; the only externally
 * reachable surface left is the feedback module, covered by
 * `feedback.spec.ts`.)
 */

const patchApiLinks = async (page: Page, targetId: number) => {
  await page.evaluate((id) => {
    const node = document.getElementById("__ssr");
    if (!node?.textContent) return;
    const parsed = JSON.parse(node.textContent);
    const links = parsed["alepha.server.request.apiLinks"];
    if (!links?.actions) return;
    for (const key of Object.keys(links.actions)) {
      const action = links.actions[key];
      action.path = action.path
        .replace(/:id\b/g, String(id))
        .replace(/:projectId\b/g, String(id));
    }
    node.textContent = JSON.stringify(parsed);
  }, targetId);
};

const callAction = async (
  page: Page,
  action: string,
  body?: unknown,
): Promise<{ status: number; text: string }> => {
  return await page.evaluate(
    async ({ action, body }) => {
      const node = document.getElementById("__ssr");
      if (!node?.textContent) throw new Error("__ssr missing");
      const parsed = JSON.parse(node.textContent) as {
        "alepha.server.request.apiLinks"?: {
          prefix?: string;
          actions?: Record<string, { path: string; method?: string }>;
        };
      };
      const links = parsed["alepha.server.request.apiLinks"];
      const entry = links?.actions?.[action];
      if (!entry) throw new Error(`Unknown action: ${action}`);
      const method = entry.method ?? (body !== undefined ? "POST" : "GET");
      const url = `${links?.prefix ?? "/api"}${entry.path}`;
      const r = await fetch(url, {
        method,
        credentials: "include",
        ...(body !== undefined
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
      });
      return { status: r.status, text: await r.text() };
    },
    { action, body },
  );
};

test.describe("Project membership gate", () => {
  test("non-member is denied on every project endpoint (read and write)", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    // ── User A: owner ────────────────────────────────────────────────
    const ownerEmail = `owner-${Date.now()}@example.com`;
    await registerAndVerify(page, ownerEmail, "GoodPassw0rd");
    const projectTitle = `Sec${Date.now()}`.slice(0, 20);
    const { id: projectId } = await createProjectViaWizard(page, projectTitle);

    // ── User B: separate account, never invited ──────────────────────
    const b = await newUserContext(browser, baseURL!, "stranger");
    try {
      await b.page.goto("/");
      await b.page.waitForLoadState("domcontentloaded");
      await patchApiLinks(b.page, projectId);

      // Reads — every one of these used to leak under the old `public`
      // flag; now they all require membership. `getAreas` lives on
      // `AreaController` now, params `{ projectId }` — `patchApiLinks`
      // already substitutes `:projectId` generically for every action, so
      // no special-casing is needed here.
      const reads = [
        "getProjectById",
        "getAreas",
        "getProjectMembers",
        "getProjectUsers",
        "getReportsOverview",
        "getReportsQuests",
        "getReportsMembers",
        "getBoard",
      ] as const;
      for (const action of reads) {
        const res = await callAction(b.page, action);
        expect(res.status, `${action} should be denied`).toBe(403);
      }

      // Writes
      const updateResp = await callAction(b.page, "updateProjectById", {
        title: "pwned",
      });
      expect(updateResp.status).toBe(403);

      // `renameArea` addresses a specific area by id (`params: { id }`), which
      // a stranger who was never let into the project has no way to know.
      // `mergeAreas` covers the same write surface (project-scoped,
      // owner-gated `params: { projectId }`) without needing one — and
      // `assertOwner` runs before either fabricated id is ever looked up,
      // so the 403 fires regardless of whether they exist.
      const mergeAreasResp = await callAction(b.page, "mergeAreas", {
        sourceIds: [1],
        targetId: 2,
      });
      expect(mergeAreasResp.status).toBe(403);

      const addColResp = await callAction(b.page, "addKanbanColumn", {
        name: "pwned-col",
      });
      expect(addColResp.status).toBe(403);

      const deleteResp = await callAction(b.page, "deleteProjectById");
      expect(deleteResp.status).toBe(403);
    } finally {
      await b.ctx.close();
    }
  });
});
