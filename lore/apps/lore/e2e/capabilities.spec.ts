import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import {
  createProjectViaWizard,
  registerAndVerify,
  setCapability,
} from "./_helpers.ts";

/**
 * The three project shapes this epic exists to make possible, end to end.
 *
 * A Lore project used to be a quest tracker with extras: every project had
 * quests whether it wanted them or not, because Quests owned the root and had
 * no flag at all. These are the shapes that were unreachable before, and each
 * case asserts the same three things from a different angle - what the sidebar
 * offers, what a URL typed by hand answers, and what the palette and the
 * create menu will let you start.
 *
 * ⚠️ **Every capability switch is optimistic.** `aria-checked` flips on click
 * and proves nothing about what was stored, and the client batches calls in a
 * ~10ms window, so navigating right after a click cancels a request that has
 * not been sent. The everything-off case therefore arms `waitForResponse`
 * before each click. The two setup-only cases go through `setCapability`,
 * which is a direct awaited PUT and has no such race.
 */

/**
 * The `href`s the project sidebar currently offers, relative to the project.
 *
 * Read as hrefs rather than by label: a label is localized and a heading is
 * ambiguous, while an `href` is what the entry actually is. `/` is Activity,
 * which is Core and must survive every case here.
 */
const navHrefs = async (page: Page, slug: string): Promise<string[]> => {
  const hrefs = await page
    .locator(`[data-slot="sidebar"] a[href^="/${slug}"]`)
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLAnchorElement).getAttribute("href")!),
    );
  return [
    ...new Set(
      hrefs
        .map((href) => href.slice(`/${slug}`.length) || "/")
        .filter((href) => !href.startsWith("/settings")),
    ),
  ].sort();
};

const expect404 = async (page: Page, path: string) => {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/page not found/i), path).toBeVisible({
    timeout: 10_000,
  });
};

const openPalette = async (page: Page, query: string) => {
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.getByPlaceholder(/search/i).last();
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill(query);
  // The search is debounced and batched; give the list a beat to settle
  // rather than asserting on the first paint, which is always empty.
  await page.waitForTimeout(1_200);
};

const openCreateMenu = async (page: Page) => {
  await page.getByTestId("project-create-menu").click();
  await expect(page.getByRole("menu")).toBeVisible({ timeout: 10_000 });
};

test.describe("Project capabilities", () => {
  test("a Knowledge-only project has folios and nothing else", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const ts = Date.now();
    await registerAndVerify(page, `kno${ts}@example.com`, "GoodPassw0rd");

    // Through the wizard with Work unchecked. `project-wizard.spec.ts` owns
    // the wizard's own behaviour (including that this path is two steps, not
    // three); what is asserted here is the project it produces.
    await page.goto("/new-project");
    await page.waitForLoadState("networkidle");
    await page
      .locator('input[type="text"]')
      .first()
      .fill(`Kno${ts}`.slice(0, 20));
    await page.getByRole("button", { name: /^next$/i }).click();
    await page.getByRole("button", { name: /plan and track work/i }).click();
    await page.getByRole("button", { name: /create project/i }).click();
    await page.waitForURL(
      (url) =>
        url.pathname !== "/new-project" &&
        url.pathname.split("/").filter(Boolean).length === 1,
      { timeout: 15_000 },
    );
    const slug = new URL(page.url()).pathname.split("/").find(Boolean)!;

    // Activity and Reports are Core, Folios is Knowledge's. Nothing else.
    expect(await navHrefs(page, slug)).toEqual(["/", "/folios", "/reports"]);

    // A URL typed by hand is a page that does not exist, not a 403 and not a
    // redirect: the project genuinely has no such surface.
    await expect404(page, `/${slug}/quests`);
    await expect404(page, `/${slug}/apps`);
    await expect404(page, `/${slug}/feedback`);

    await page.goto(`/${slug}/`);
    await page.waitForLoadState("networkidle");

    await openPalette(page, "a");
    // The palette would otherwise be the one surface left offering a way into
    // Work, from a keystroke, past every route guard above.
    await expect(page.getByText(/^quests$/i)).toHaveCount(0);
    await page.keyboard.press("Escape");

    await openCreateMenu(page);
    await expect(
      page.getByRole("menuitem", { name: /new folio/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: /new quest/i }),
    ).toHaveCount(0);
  });

  test("an Apps-only project watches apps and drops the feedback they send", async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000);

    const ts = Date.now();
    await registerAndVerify(page, `app${ts}@example.com`, "GoodPassw0rd");
    const { id, slug } = await createProjectViaWizard(
      page,
      `App${ts}`.slice(0, 20),
      { capabilities: ["apps"], options: { apps: ["track"] } },
    );
    // The wizard's own defaults are Work and Knowledge; this project is Apps
    // alone, so both come back off.
    await setCapability(page, id, "work", { enabled: false });
    await setCapability(page, id, "knowledge", { enabled: false });
    await page.reload();
    await page.waitForLoadState("networkidle");

    expect(await navHrefs(page, slug)).toEqual([
      "/",
      "/apps",
      "/artifacts",
      "/reports",
    ]);
    // Support is off, so the inbox is not a page this project has.
    await expect404(page, `/${slug}/feedback`);

    // Enrol one deployed copy, then mint its sigil from the Settings tab the
    // way an operator does - it is the only place the cleartext token exists.
    // A fresh sigil carries all four kinds, `feedback` included, which is
    // exactly the app this case is about: one reporting something the project
    // does not collect.
    const created = await page.evaluate(
      async ({ projectId }) => {
        const r = await fetch(`/api/projects/${projectId}/apps`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ app: "club", env: "production" }),
        });
        return r.ok;
      },
      { projectId: id },
    );
    expect(created).toBe(true);

    await page.goto(`/${slug}/apps/club/production/settings`);
    await page.waitForLoadState("networkidle");
    await page
      .getByRole("button", { name: "Create a sigil", exact: true })
      .click();
    const panel = page
      .getByRole("alert")
      .filter({ hasText: /Copy this token/i });
    await expect(panel).toBeVisible({ timeout: 15_000 });
    const token = (await panel.locator("code").first().innerText()).trim();
    expect(token).toMatch(/^sg_/);

    // ⚠️ Through Playwright's isolated `request` fixture, never the page: the
    // page's `fetch` is patched to attach the session bearer, which would
    // replace the sigil token and prove nothing about the ingest credential.
    const baseURL = new URL(page.url()).origin;
    const ingest = await request.post(`${baseURL}/sigils/ingest`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        environment: "production",
        host: "club.example.com",
        events: [
          { kind: "feedback", title: "dropped", description: "on the floor" },
        ],
      },
    });
    // ⚠️ **Accepted, and discarded.** The reporting client fails open on any
    // config error, so refusing the batch would make an enrolled app retry
    // forever. `gatesFor` needs `apps.track` AND `support` for this kind, and
    // Support is off - so the batch is 2xx and nothing is written.
    expect(ingest.ok()).toBe(true);

    const feedbackCount = await page.evaluate(
      async ({ projectId }) => {
        const r = await fetch(
          `/api/projects/${projectId}/feedback?status=pending`,
          { credentials: "include" },
        );
        if (!r.ok) return -1;
        const body = (await r.json()) as { items: unknown[] };
        return body.items.length;
      },
      { projectId: id },
    );
    expect(feedbackCount).toBe(0);

    // And the app's Settings tab says so, which is the whole point: from both
    // ends the app looks healthy, because `absorb` stamps `lastSeenAt` for a
    // batch every gate rejected.
    await page.goto(`/${slug}/apps/club/production/settings`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/feedback is not collected/i)).toBeVisible({
      timeout: 15_000,
    });

    // Reports is Core and its tabs declare their own capability: Members
    // comes from a core table and survives with no capability at all.
    await page.goto(`/${slug}/reports`);
    await page.waitForLoadState("networkidle");
    await expect(
      page.locator(`a[href="/${slug}/reports/members"]`),
    ).toBeVisible({ timeout: 15_000 });
    // Overview and Quests belong to Work, which is off.
    await expect(page.locator(`a[href="/${slug}/reports/quests"]`)).toHaveCount(
      0,
    );
    // Quality is Apps baseline and self-hides until a run exists, so it is
    // absent right up to the push below.
    await expect(
      page.locator(`a[href="/${slug}/reports/quality"]`),
    ).toHaveCount(0);

    // ⚠️ Quality has no switch, and this is why an Apps-only project needs
    // Reports to stay Core: pushed by CI under a CI credential, its tab is the
    // one thing an Apps-only project reads there besides Members. If Reports
    // had stayed under Work, the entry would have taken this with it.
    const pushed = await page.evaluate(
      async ({ projectId }) => {
        const r = await fetch(`/api/projects/${projectId}/quality/runs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            commitSha: "abcdef1234567",
            branch: "main",
            coverage: {
              lines: 91.2,
              statements: 90.4,
              functions: 88,
              branches: 79.5,
            },
            tests: { total: 120, passed: 119, failed: 0, skipped: 1 },
            durationMs: 42_000,
          }),
        });
        return r.ok;
      },
      { projectId: id },
    );
    expect(pushed).toBe(true);

    await page.goto(`/${slug}/reports`);
    await page.waitForLoadState("networkidle");
    await expect(
      page.locator(`a[href="/${slug}/reports/quality"]`),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("everything off leaves a project that still works, and gives it all back", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const ts = Date.now();
    await registerAndVerify(page, `off${ts}@example.com`, "GoodPassw0rd");
    const { id, slug } = await createProjectViaWizard(
      page,
      `Off${ts}`.slice(0, 20),
      { capabilities: ["apps", "support"] },
    );

    // Something in each capability, so "hides, never deletes" has something
    // to hide. The quest is what the last assertion reads back.
    await page.evaluate(
      async ({ projectId }) => {
        const r = await fetch("/api/createQuest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            projectId,
            title: "Survives being hidden",
            description: "",
            area: "general",
            priority: "medium",
          }),
        });
        if (!r.ok) throw new Error(await r.text());
      },
      { projectId: id },
    );

    // ⚠️ Off from SETTINGS, one page at a time, through the real switches -
    // this case is about the pages a person uses, and `setCapability` would
    // skip the optimistic control the epic's e2e traps are about. Each click
    // is armed first: the switch flips instantly and proves nothing, and
    // navigating before the batch window closes cancels the save outright.
    for (const key of ["work", "knowledge", "apps", "support"]) {
      await page.goto(`/${slug}/settings/${key}`);
      await page.waitForLoadState("networkidle");
      const master = page.getByRole("switch", { name: /enable/i }).first();
      await expect(master).toHaveAttribute("aria-checked", "true", {
        timeout: 10_000,
      });
      const saved = page.waitForResponse((res) =>
        res.url().includes(`/capabilities/${key}`),
      );
      await master.click();
      expect((await saved).ok(), key).toBe(true);
    }

    await page.goto(`/${slug}/`);
    await page.waitForLoadState("networkidle");

    // Activity and Reports, and that is the whole project. A legal state by
    // the epic's decision 8, and the test that the modularity is real.
    expect(await navHrefs(page, slug)).toEqual(["/", "/reports"]);

    // The feed still renders what happened while the capabilities were on:
    // the rows are filtered by kind, never purged.
    await expect(page.getByText(/activity/i).first()).toBeVisible({
      timeout: 15_000,
    });

    await openCreateMenu(page);
    // Invite belongs to no capability, so the owner keeps it - and it is the
    // only thing left.
    await expect(
      page.getByRole("menuitem", { name: /invite member/i }),
    ).toBeVisible();
    await expect(page.getByRole("menuitem")).toHaveCount(1);
    await page.keyboard.press("Escape");

    await openPalette(page, "survives");
    await expect(page.getByText(/^quests$/i)).toHaveCount(0);
    await expect(page.getByText(/^folios$/i)).toHaveCount(0);
    await page.keyboard.press("Escape");

    for (const path of ["quests", "folios", "apps", "feedback"]) {
      await expect404(page, `/${slug}/${path}`);
    }

    // ⚠️ Settings still reaches all four capability pages, and it has to: a
    // page you cannot reach is a capability you cannot turn back on. Members
    // and Estates are Core and stay too.
    await page.goto(`/${slug}/settings`);
    await page.waitForLoadState("networkidle");
    for (const page404 of [
      "work",
      "knowledge",
      "apps",
      "support",
      "members",
      "estates",
    ]) {
      await expect(
        page.locator(`a[href="/${slug}/settings/${page404}"]`),
        page404,
      ).toBeVisible({ timeout: 10_000 });
    }
    // Areas belongs to Work, so it is the one settings entry that goes.
    await expect(page.locator(`a[href="/${slug}/settings/areas"]`)).toHaveCount(
      0,
    );

    // And back. Nothing was deleted, so the quest is exactly where it was -
    // "hides, never deletes", proven from the outside.
    await page.goto(`/${slug}/settings/work`);
    await page.waitForLoadState("networkidle");
    const back = page.waitForResponse((res) =>
      res.url().includes("/capabilities/work"),
    );
    await page
      .getByRole("switch", { name: /enable/i })
      .first()
      .click();
    expect((await back).ok()).toBe(true);

    await page.goto(`/${slug}/quests`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Survives being hidden")).toBeVisible({
      timeout: 15_000,
    });
  });
});
