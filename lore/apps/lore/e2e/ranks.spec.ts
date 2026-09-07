import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import {
  apiPath,
  createProjectViaWizard,
  newUserContext,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * The project's integer id, which the HTTP API still takes even though every
 * URL takes the slug.
 *
 * ⚠️ Through `apiPath`, never a hand-written path: an action that declares no
 * `path` gets one inferred from its name, so a literal here is a guess that
 * answers 404 with an HTML body and fails the next `.json()` rather than the
 * assertion it was written for.
 */
const projectIdOf = async (page: Page, slug: string): Promise<number> => {
  const url = (await apiPath(page, "getProjectBySlug")).replace(":slug", slug);
  return await page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: "include" });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return (await r.json()).id as number;
  }, url);
};

/**
 * The three things epic #E39 exists to make possible, proven end to end.
 *
 * Every one of them is a claim about ABSENCE, which is the hard half: a
 * refused API call is easy to assert and easy to pass with a button that is
 * still on screen. "Present and failing" is the shape this epic set out to
 * remove, so each case here asserts what is NOT rendered as well as what the
 * server answers.
 *
 * ⚠️ Lore e2e traps that all apply here:
 * - calls are batched through `/api/_batch`, so a navigation right after a
 *   click can cancel a request that has not been sent yet;
 * - the rank picker is a Base UI popover, which leaves `pointer-events: none`
 *   on the body after it closes;
 * - the picker is NOT optimistic (it follows the server's answer), but the
 *   response is still armed before every rank change, because the assertion
 *   after it reads a page the response is what refills.
 */

/**
 * The project sidebar's own hrefs, and the settings rail's separately.
 *
 * Read as hrefs rather than by label, the way `capabilities.spec.ts` does: a
 * label is localized and a heading is ambiguous, while an href is what the
 * entry actually is.
 */
const railHrefs = async (page: Page, slug: string): Promise<string[]> => {
  const hrefs = await page
    .locator(`a[href^="/${slug}/settings"]`)
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLAnchorElement).getAttribute("href")!),
    );
  return [...new Set(hrefs)].sort();
};

/**
 * Invite somebody, with the rank they land on picked in the dialog.
 *
 * The rank field is #Q1932's, and using it here is deliberate: it exercises
 * the invitation path (validated at create, read at grant) rather than only
 * the picker on the members page.
 */
const inviteWithRank = async (
  page: Page,
  slug: string,
  email: string,
  rankName: RegExp,
): Promise<void> => {
  await page.goto(`/${slug}/settings/members`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^invite$/i }).click();
  await expect(
    page.getByRole("heading", { name: /invite a user/i }),
  ).toBeVisible();
  await page.getByPlaceholder("user@example.com").fill(email);

  await page.getByTestId("invite-rank").click();
  await page.getByRole("option", { name: rankName }).click();
  // ⚠️ The popover's `pointer-events: none` outlives its own closing
  // animation, so the next click lands on nothing without this.
  await expect(page.getByRole("option", { name: rankName })).toBeHidden();

  const created = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" && r.url().endsWith("/api/invitations"),
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: /send invitation/i }).click();
  expect((await created).ok()).toBe(true);
};

const accept = async (page: Page, projectTitle: string): Promise<void> => {
  await page.goto("/account/invitations");
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByText(projectTitle).first()).toBeVisible({
    timeout: 10_000,
  });

  const accepted = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/api\/invitations\/[^/]+\/accept$/.test(r.url()),
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: /^accept$/i }).click();
  expect((await accepted).ok()).toBe(true);
};

test.describe("Ranks", () => {
  test("a contributor writes the work and cannot touch the configuration", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);

    await registerAndVerify(
      page,
      `owner-${Date.now()}@example.com`,
      "GoodPassw0rd",
    );
    const title = `Rk${Date.now()}`.slice(0, 20);
    const { slug } = await createProjectViaWizard(page, title);

    const b = await newUserContext(browser, baseURL!, "contributor");
    try {
      await inviteWithRank(page, slug, b.email, /^contributor$/i);
      await accept(b.page, title);

      // ── The work: a Contributor may write it ──────────────────────────
      await b.page.goto(`/${slug}/quests`);
      await b.page.waitForLoadState("networkidle");
      // The list renders, and the create control is THERE. Half of this
      // epic's risk is hiding too much.
      await expect(b.page.getByTestId("project-create-menu")).toBeVisible({
        timeout: 10_000,
      });

      // ── The configuration: absent, not present-and-failing ────────────
      await b.page.goto(`/${slug}/settings/members`);
      await b.page.waitForLoadState("networkidle");

      const rail = await railHrefs(b.page, slug);
      // ⚠️ The assertion #Q1930's trap needed. The Ranks page is
      // `rank:manage`, which a Contributor does not hold, so its entry is
      // not in the rail at all - rather than a link to a matrix that saves
      // nothing.
      expect(rail).not.toContain(`/${slug}/settings/ranks`);
      // And the entries a Contributor DOES reach are still there, so this is
      // not a rail that failed to render.
      expect(rail.length).toBeGreaterThan(0);

      // No Invite button, no rank pickers, no member menus.
      await expect(
        b.page.getByRole("button", { name: /^invite$/i }),
      ).toHaveCount(0);
      await expect(b.page.getByTestId("member-rank")).toHaveCount(0);
      await expect(b.page.getByTestId("member-actions")).toHaveCount(0);

      // ── The API agrees, and names the permission ──────────────────────
      const projectId = await projectIdOf(b.page, slug);
      const updateUrl = (await apiPath(b.page, "updateProjectById")).replace(
        ":id",
        String(projectId),
      );
      const updateMethod = await b.page.evaluate(() => {
        const node = document.getElementById("__ssr");
        const parsed = JSON.parse(node!.textContent!) as {
          "alepha.server.request.apiLinks": {
            actions: Record<string, { method?: string }>;
          };
        };
        return parsed["alepha.server.request.apiLinks"].actions
          .updateProjectById.method;
      });

      // ⚠️ Asserted rather than used as a variable, and both halves matter.
      // `$action` INFERS a method from the body when none is declared, so a
      // literal here is a guess - and a wrong one answers 404, which reads as
      // "the gate let it through and the route is missing", the opposite of
      // what this case is about. Reading the registry and then pinning the
      // literal keeps the contract visible in the spec.
      expect(updateMethod).toBe("POST");

      const refusal = await b.page.evaluate(async (url) => {
        const res = await fetch(url, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Renamed by a contributor" }),
        });
        return { status: res.status, body: await res.text() };
      }, updateUrl);

      expect(refusal.status).toBe(403);
      // ⚠️ The message has to name the permission AND the fix. "Forbidden"
      // leaves the reader - very often an agent - with nowhere to go.
      expect(refusal.body).toContain("project:update");
      expect(refusal.body).toMatch(/ask the project owner/i);
    } finally {
      await b.ctx.close();
    }
  });

  test("a viewer sees every read surface and no write control", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);

    await registerAndVerify(
      page,
      `owner2-${Date.now()}@example.com`,
      "GoodPassw0rd",
    );
    const title = `Vw${Date.now()}`.slice(0, 20);
    const { slug } = await createProjectViaWizard(page, title);

    const c = await newUserContext(browser, baseURL!, "viewer");
    try {
      await inviteWithRank(page, slug, c.email, /^viewer$/i);
      await accept(c.page, title);

      // ── Quests: the list is there, the create menu is not ─────────────
      await c.page.goto(`/${slug}/quests`);
      await c.page.waitForLoadState("networkidle");
      // The read surface renders: the sidebar still offers the project's
      // pages, which is what makes "no write control" a rank and not a 404.
      await expect(c.page.locator(`a[href^="/${slug}"]`).first()).toBeVisible({
        timeout: 10_000,
      });
      // ⚠️ The whole point. `ProjectActionsCreateButton` renders nothing at
      // all for a rank that may create none of the things it offers.
      await expect(c.page.getByTestId("project-create-menu")).toHaveCount(0);

      // ── Folios: the workspace opens, the tree offers no writes ────────
      await c.page.goto(`/${slug}/folios`);
      await c.page.waitForLoadState("networkidle");
      await expect(
        c.page.getByRole("button", { name: /new folio/i }),
      ).toHaveCount(0);
      await expect(
        c.page.getByRole("button", { name: /new directory/i }),
      ).toHaveCount(0);

      // ── Members: readable, and nothing to change ──────────────────────
      await c.page.goto(`/${slug}/settings/members`);
      await c.page.waitForLoadState("networkidle");
      // ⚠️ It RENDERS. This page answered a hard 403 error page to every
      // non-manager until #Q1932: its loader fetched the pending
      // invitations, which are `member:manage`, while the list itself is
      // `member:read` - which every rank holds.
      await expect(c.page.getByText(/members/i).first()).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        c.page.getByRole("button", { name: /^invite$/i }),
      ).toHaveCount(0);
      await expect(c.page.getByTestId("member-rank")).toHaveCount(0);
    } finally {
      await c.ctx.close();
    }
  });

  test("transferring ownership demotes the promoter, in one action", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);

    await registerAndVerify(
      page,
      `owner3-${Date.now()}@example.com`,
      "GoodPassw0rd",
    );
    const title = `Tr${Date.now()}`.slice(0, 20);
    const { slug } = await createProjectViaWizard(page, title);

    const d = await newUserContext(browser, baseURL!, "successor");
    try {
      await inviteWithRank(page, slug, d.email, /^contributor$/i);
      await accept(d.page, title);

      await page.goto(`/${slug}/settings/members`);
      await page.waitForLoadState("networkidle");

      await page.getByTestId("member-actions").first().click();
      await page.getByRole("menuitem", { name: /transfer ownership/i }).click();

      // The promoter's new rank is a real choice, and it lands on the row.
      await page.getByTestId("transfer-keep").click();
      await page.getByRole("option", { name: /^viewer$/i }).click();
      await expect(
        page.getByRole("option", { name: /^viewer$/i }),
      ).toBeHidden();

      const transferred = page.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().endsWith("/transfer"),
        { timeout: 20_000 },
      );
      await page.getByTestId("transfer-submit").click();
      // ⚠️ A real confirmation, spelling out the consequence, and never
      // `window.confirm`: it demotes the person clicking it and cannot be
      // undone by them.
      await expect(
        page.getByText(/only the new owner can give it back/i),
      ).toBeVisible({ timeout: 10_000 });
      await page.getByRole("button", { name: /transfer it/i }).click();
      expect((await transferred).ok()).toBe(true);

      // ── Exactly one owner, and it is the other one ────────────────────
      const projectId = await projectIdOf(page, slug);
      const membersUrl = (await apiPath(page, "getProjectMembers")).replace(
        ":id",
        String(projectId),
      );
      const after = await page.evaluate(async (url) => {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        const members = (await res.json()) as Array<{ rank?: string }>;
        return members.map((m) => m.rank ?? null);
      }, membersUrl);

      expect(after.filter((rank) => rank === "owner")).toHaveLength(1);
      expect(after).toContain("viewer");

      // ── The former owner loses access in the same session ─────────────
      await page.goto(`/${slug}/settings/members`);
      await page.waitForLoadState("networkidle");
      // No waiting out a window: the ASSIGNMENT is never cached, so the
      // demotion is live on the very next request.
      await expect(page.getByRole("button", { name: /^invite$/i })).toHaveCount(
        0,
      );
      expect(await railHrefs(page, slug)).not.toContain(
        `/${slug}/settings/ranks`,
      );

      // ── And the new owner can give it back, which is the only path ────
      await d.page.goto(`/${slug}/settings/members`);
      await d.page.waitForLoadState("networkidle");
      await expect(
        d.page.getByRole("button", { name: /^invite$/i }),
      ).toBeVisible({ timeout: 10_000 });
      await expect(d.page.getByTestId("member-actions").first()).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await d.ctx.close();
    }
  });
});
