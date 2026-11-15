import type { Browser, Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import {
  apiPath,
  apiPost,
  confirmDialog,
  createProjectViaWizard,
  newUserContext,
  registerAndVerify,
  saveRank,
  submitSignInForm,
} from "./_helpers.ts";

/**
 * Open projects end to end: anyone signed in can join as a viewer, nobody
 * else learns the project exists, and an admin keeps the last word.
 */

const call = async (
  page: Page,
  action: string,
  method: string,
  path: Record<string, string | number> = {},
  body?: unknown,
): Promise<number> => {
  let url = await apiPath(page, action);
  for (const [key, value] of Object.entries(path)) {
    url = url.replace(`:${key}`, String(value));
  }
  return page.evaluate(
    async ({ url, method, body }) =>
      (
        await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
      ).status,
    { url, method, body },
  );
};

/**
 * The owner's project, with one quest a stranger's link points at.
 */
const ownProject = async (page: Page, title: string) => {
  const project = await createProjectViaWizard(page, title);
  const quest = await apiPost<{ id: number; shortId: number; title: string }>(
    page,
    "createQuest",
    {
      projectId: project.id,
      title: `Read me ${Date.now()}`,
      description: "",
      area: "lore/quests",
      priority: "high",
      objectives: [],
      attachments: [],
    },
  );
  return { ...project, quest, url: `/${project.slug}/quests/${quest.shortId}` };
};

/**
 * Open the project from Members settings, as an owner does.
 */
const openProject = async (page: Page, slug: string) => {
  await page.goto(`/${slug}/settings/members`);
  await page.waitForLoadState("networkidle");
  await page
    .getByRole("radio", { name: /open: anyone signed in can join/i })
    .click();
  await confirmDialog(page, "Open the project");
  await expect(
    page.getByRole("radio", { name: /open: anyone signed in can join/i }),
  ).toBeChecked();
};

/**
 * An account that exists and is signed out again: a fresh context that
 * registered, then a second, cookie-less context for the visit.
 */
const strangerAccount = async (browser: Browser, baseURL: string) => {
  const registered = await newUserContext(browser, baseURL, "stranger");
  await registered.ctx.close();
  const ctx = await browser.newContext({ baseURL });
  return { ctx, page: await ctx.newPage(), email: registered.email };
};

const expect404 = async (page: Page) => {
  await expect(page.getByText("404", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Page not found")).toBeVisible();
  expect(new URL(page.url()).pathname).not.toMatch(/^\/auth\//);
};

test.describe("open projects", () => {
  // Every test is the owner's, signed in on the default page.
  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000);
    await registerAndVerify(
      page,
      `owner-${Date.now()}-${Math.floor(Math.random() * 1000)}@example.com`,
      "GoodPassw0rd",
    );
  });

  test("a new project has owner, admin, member and viewer", async ({
    page,
  }) => {
    const project = await createProjectViaWizard(
      page,
      `Ranks${Date.now()}`.slice(0, 20),
    );
    const list = (await apiPath(page, "getOrganizationRanks")).replace(
      ":organizationId",
      project.organizationId,
    );
    const ranks = (await (await page.request.get(list)).json()) as {
      items: Array<{ key: string }>;
    };
    expect(ranks.items.map((it) => it.key).sort()).toEqual([
      "admin",
      "member",
      "owner",
      "viewer",
    ]);
  });

  test("strangers get a 404 on an invite-only project's quest, signed out or in", async ({
    page,
    browser,
    baseURL,
  }) => {
    const project = await ownProject(page, `Closed${Date.now()}`.slice(0, 20));

    const anonymous = await browser.newContext({ baseURL });
    try {
      const visitor = await anonymous.newPage();
      await visitor.goto(project.url);
      await expect404(visitor);
      await expect(visitor.getByText(project.quest.title)).toHaveCount(0);
    } finally {
      await anonymous.close();
    }

    const stranger = await newUserContext(browser, baseURL!, "outsider");
    try {
      await stranger.page.goto(project.url);
      await expect404(stranger.page);
      await expect(stranger.page.getByText(project.quest.title)).toHaveCount(0);
    } finally {
      await stranger.ctx.close();
    }
  });

  test("a stranger joins from the link, signs in, and lands on the quest as a viewer who reads and is refused", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const project = await ownProject(page, `Open${Date.now()}`.slice(0, 20));
    await openProject(page, project.slug);

    const stranger = await strangerAccount(browser, baseURL!);
    try {
      const visitor = stranger.page;

      // The Join page: the card and the button, nothing of the project.
      await visitor.goto(project.url);
      await expect(visitor.getByTestId("project-join-page")).toBeVisible({
        timeout: 15_000,
      });
      await expect(visitor.getByText(project.quest.title)).toHaveCount(0);
      await visitor.getByRole("button", { name: /sign in to join/i }).click();

      // Sign in, carrying the way back.
      await visitor.waitForURL(/\/auth\/login\?redirect=/);
      expect(new URL(visitor.url()).searchParams.get("redirect")).toBe(
        project.url,
      );
      await submitSignInForm(visitor, stranger.email, "GoodPassw0rd");

      // Back on the quest, a member on Viewer.
      await visitor.waitForURL((url) => url.pathname === project.url, {
        timeout: 20_000,
      });
      await expect(visitor.getByText(project.quest.title).first()).toBeVisible({
        timeout: 15_000,
      });
      // Reloaded so the page's API links are the signed-in ones: the list a
      // page carries is the one its first, signed-out load was rendered with.
      await visitor.reload();
      await expect(visitor.getByText(project.quest.title).first()).toBeVisible({
        timeout: 15_000,
      });
      const resolved = await visitor.evaluate(
        async (url) =>
          (await (await fetch(url, { credentials: "include" })).json()) as {
            rank?: { key: string };
          },
        (await apiPath(visitor, "getProjectBySlug")).replace(
          ":slug",
          project.slug,
        ),
      );
      expect(resolved.rank?.key).toBe("viewer");

      // Reads: quests and folios.
      await visitor.goto(`/${project.slug}/folios`);
      await expect(visitor.getByText("Page not found")).toHaveCount(0);

      // Refusals: automations, errors, member emails, feedback attachments.
      const id = { projectId: project.id };
      expect(await call(visitor, "listAutomations", "GET", id)).toBe(403);
      expect(await call(visitor, "listProjectErrors", "GET", id)).toBe(403);
      expect(
        await call(visitor, "getOrganizationMembers", "GET", {
          organizationId: project.organizationId,
        }),
      ).toBe(403);
      expect(
        await call(visitor, "getFeedbackAttachment", "GET", {
          ...id,
          feedbackId: 1,
          attachmentId: "00000000-0000-4000-8000-000000000000",
        }),
      ).toBe(403);
    } finally {
      await stranger.ctx.close();
    }
  });

  test("a viewer an admin removed cannot rejoin until the admin lets them back", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const project = await ownProject(page, `Removal${Date.now()}`.slice(0, 20));
    await openProject(page, project.slug);

    const viewer = await newUserContext(browser, baseURL!, "viewer");
    try {
      await viewer.page.goto(project.url);
      await viewer.page
        .getByRole("button", { name: /^join project$/i })
        .click();
      await expect(
        viewer.page.getByText(project.quest.title).first(),
      ).toBeVisible({ timeout: 15_000 });
      const me = await viewer.page.evaluate(
        async () =>
          (await (
            await fetch("/api/users/me", { credentials: "include" })
          ).json()) as { id: string },
      );

      // The owner removes them: the exclusion is written.
      expect(
        await call(page, "removeMember", "POST", {
          id: project.id,
          userId: me.id,
        }),
      ).toBe(200);

      await viewer.page.goto(project.url);
      await viewer.page
        .getByRole("button", { name: /^join project$/i })
        .click();
      await expect(
        viewer.page.getByTestId("project-join-refusal"),
      ).toContainText(/cannot rejoin/i);

      // The owner lifts it, and the same click joins.
      expect(
        await call(page, "liftProjectExclusion", "DELETE", {
          id: project.id,
          userId: me.id,
        }),
      ).toBe(200);
      await viewer.page.goto(project.url);
      await viewer.page
        .getByRole("button", { name: /^join project$/i })
        .click();
      await expect(
        viewer.page.getByText(project.quest.title).first(),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await viewer.ctx.close();
    }
  });

  test("widening Viewer while the project is open is refused", async ({
    page,
  }) => {
    const project = await ownProject(page, `Locked${Date.now()}`.slice(0, 20));
    await openProject(page, project.slug);

    const path = (await apiPath(page, "saveOrganizationRank"))
      .replace(":organizationId", project.organizationId)
      .replace(":key", "viewer");
    const widened = await page.request.put(path, {
      data: { name: "Viewer", permissions: ["project:read", "quest:create"] },
    });
    expect(widened.status()).toBeGreaterThanOrEqual(400);
    expect(await widened.text()).toMatch(/quest:create/);

    // The allowlist itself still saves.
    await saveRank(page, project.organizationId, "viewer", "Viewer", [
      "project:read",
      "quest:read",
    ]);
  });
});
