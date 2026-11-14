import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Page } from "@playwright/test";
import WebSocket from "ws";

import { expect, test } from "./_fixtures.ts";
import {
  apiPath,
  confirmDialog,
  createHostInProject,
  createProjectViaWizard,
  createRankFromPreset,
  newUserContext,
  openAccount,
  registerAndVerify,
  releasePointerEvents,
  signInAsAdmin,
} from "./_helpers.ts";

/**
 * Hosts belong to a project, managed by rank (epic #E126, #Q3281).
 *
 * In the browser, on built artefacts: a plain Member of the home project
 * reads the console and is offered nothing to change, a member on the Admin
 * preset (which carries `host:update`, `host:create`, `host:delete`)
 * rotates, the owner moves the host to another project from Settings, and
 * the instance admin assigns it back from `/admin/hosts`.
 *
 * ⚠️ No suite can make a host with no home (only the migration does), so
 * the admin assigns one that has a home; the homeless row is a browser spec
 * (`AdminHosts.browser.spec.tsx`) and a server spec (`host-move.spec.ts`).
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
  await expect(page.getByRole("option", { name: rankName })).toBeHidden();
  const created = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/invitations"),
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: /send invitation/i }).click();
  expect((await created).ok()).toBe(true);
};

const accept = async (page: Page, projectTitle: string): Promise<void> => {
  await openAccount(page, "invitations");
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

/**
 * Call one `$action` by name over the page's session, answering its status
 * and body rather than throwing: the scenario asserts refusals as much as
 * successes.
 */
const call = async (
  page: Page,
  action: string,
  method: string,
  path: Record<string, string | number> = {},
  body?: unknown,
): Promise<{ status: number; body: any }> => {
  let url = await apiPath(page, action);
  for (const [key, value] of Object.entries(path)) {
    url = url.replace(`:${key}`, String(value));
  }
  return page.evaluate(
    async ({ url, method, body }) => {
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await r.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {}
      return { status: r.status, body: parsed };
    },
    { url, method, body },
  );
};

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/@lore/deploy/test/fixtures/bay/wire-v1",
);

/**
 * Play the machine once, as `bay-console.spec.ts` does: hello, welcome, the
 * wire-v1 inventory fixture, close.
 */
const pushInventory = async (baseURL: string, secret: string) => {
  const frame = JSON.parse(
    readFileSync(join(FIXTURE, "inventory.json"), "utf8"),
  );
  const socket = new WebSocket(`${baseURL.replace(/^http/, "ws")}/ws/estates`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  await new Promise<void>((done, fail) => {
    const timer = setTimeout(
      () => fail(new Error("the fake machine never completed its handshake")),
      20_000,
    );
    socket.on("error", (error) => {
      clearTimeout(timer);
      fail(error);
    });
    socket.on("open", () => socket.send(JSON.stringify({ type: "hello" })));
    socket.on("message", (raw) => {
      const text = Buffer.isBuffer(raw)
        ? raw.toString("utf8")
        : Array.isArray(raw)
          ? Buffer.concat(raw).toString("utf8")
          : Buffer.from(raw as ArrayBuffer).toString("utf8");
      if ((JSON.parse(text) as { type?: string }).type !== "welcome") return;
      socket.send(JSON.stringify(frame));
      socket.close();
    });
    socket.on("close", () => {
      clearTimeout(timer);
      done();
    });
  });
};

/**
 * The console's Settings tab, under the host's home project (#E126).
 */
const openSettings = async (
  page: Page,
  projectSlug: string,
  hostSlug: string,
): Promise<void> => {
  await page.goto(`/${projectSlug}/hosts/${hostSlug}/settings`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("bay-settings-home")).toBeVisible({
    timeout: 15_000,
  });
};

test.describe("Project hosts", () => {
  test("a member looks, a manager rotates, the owner moves it, the admin assigns it", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    await registerAndVerify(page, `pe-owner-${ts}@example.com`, "GoodPassw0rd");
    const first = await createProjectViaWizard(page, `Pe1${ts}`.slice(0, 20), {
      capabilities: ["apps"],
    });
    await createHostInProject(page, first.slug, "ovh-team");

    // The Admin preset carries the three host permissions since #E126.
    await createRankFromPreset(page, first.slug, "Admin");
    const reader = await newUserContext(browser, baseURL!, "pe-reader");
    const manager = await newUserContext(browser, baseURL!, "pe-manager");
    try {
      const title = `Pe1${ts}`.slice(0, 20);
      await inviteWithRank(page, first.slug, reader.email, /^member$/i);
      await accept(reader.page, title);
      await inviteWithRank(page, first.slug, manager.email, /^admin$/i);
      await accept(manager.page, title);

      // ── A plain Member: the console, read-only ──────────────────────────
      // The project's hosts list shows it to every member, and offers a
      // plain Member no lending.
      await reader.page.goto(`/${first.slug}/settings/hosts`);
      await reader.page.waitForLoadState("networkidle");
      await expect(
        reader.page
          .getByTestId("home-host-row")
          .filter({ hasText: "ovh-team" }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        reader.page.getByText("Lend to this project", { exact: true }),
      ).toHaveCount(0);
      await openSettings(reader.page, first.slug, "ovh-team");
      await expect(
        reader.page.getByTestId("bay-settings-readonly"),
      ).toBeVisible();
      await expect(reader.page.getByTestId("bay-settings-rotate")).toHaveCount(
        0,
      );
      await expect(reader.page.getByTestId("bay-settings-delete")).toHaveCount(
        0,
      );

      // ── A manager on the Admin rank: rotates ────────────────────────────
      await openSettings(manager.page, first.slug, "ovh-team");
      await expect(
        manager.page.getByTestId("bay-settings-readonly"),
      ).toHaveCount(0);
      await manager.page.getByTestId("bay-settings-rotate").click();
      await confirmDialog(manager.page, "Rotate");
      await expect(
        manager.page.getByTestId("my-host-secret-dialog"),
      ).toBeVisible({ timeout: 15_000 });
      await manager.page
        .getByRole("button", { name: "Done", exact: true })
        .click();
    } finally {
      await reader.ctx.close();
      await manager.ctx.close();
    }

    // ── The owner moves it to a second project ─────────────────────────────
    const second = await createProjectViaWizard(page, `Pe2${ts}`.slice(0, 20), {
      capabilities: ["apps"],
    });
    await openSettings(page, first.slug, "ovh-team");
    await page.getByTestId("bay-settings-move").click();
    await page.getByTestId("bay-move-project").click();
    await page.getByRole("option", { name: `Pe2${ts}`.slice(0, 20) }).click();
    await releasePointerEvents(page);
    await page.getByTestId("bay-move-submit").click();
    await expect(page.getByTestId("bay-settings-home")).toContainText(
      `Pe2${ts}`.slice(0, 20),
      { timeout: 15_000 },
    );
    // The console follows the host to its new home: the old URL names a
    // project it left.
    await page.waitForURL(`**/${second.slug}/hosts/ovh-team/settings`, {
      timeout: 15_000,
    });
    await page.goto(`/${second.slug}/settings/hosts`);
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByTestId("home-host-row").filter({ hasText: "ovh-team" }),
    ).toBeVisible({ timeout: 15_000 });

    // ── The admin assigns it back to the first ─────────────────────────────
    const adminCtx = await browser.newContext({ baseURL });
    const admin = await adminCtx.newPage();
    try {
      await signInAsAdmin(admin);
      await admin.goto("/admin/hosts");
      await admin.waitForLoadState("networkidle");
      const row = admin.locator("tbody tr", {
        has: admin.getByText("ovh-team", { exact: true }),
      });
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.getByRole("button", { name: /actions/i }).click();
      await admin.getByRole("menuitem", { name: "Assign to project" }).click();
      await admin.getByTestId("admin-host-assign-project").click();
      await admin
        .getByRole("option", { name: new RegExp(`^Pe1${ts}`.slice(0, 20)) })
        .click();
      await releasePointerEvents(admin);
      await admin.getByTestId("admin-host-assign-submit").click();
      await expect(row).toContainText(`Pe1${ts}`.slice(0, 20), {
        timeout: 15_000,
      });
    } finally {
      await adminCtx.close();
    }
  });

  /**
   * The sentence the epic exists for (#Q3284): a host a member created
   * outlives that member, is managed by the project's owner who created
   * nothing, is lent and moved with its loans, keeps its project from being
   * deleted, and is assigned by the instance admin.
   */
  test("a host outlives its creator, managed by rank", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(300_000);
    const ts = Date.now();
    const t1 = `Ow1${ts}`.slice(0, 20);
    const t2 = `Ow2${ts}`.slice(0, 20);
    const t3 = `Ow3${ts}`.slice(0, 20);

    // 1. Owner, two projects with Apps; Builder on a rank that manages
    //    hosts (the Admin preset), Guest a plain Member.
    await registerAndVerify(page, `ow-${ts}@example.com`, "GoodPassw0rd");
    const first = await createProjectViaWizard(page, t1, {
      capabilities: ["apps"],
    });
    const second = await createProjectViaWizard(page, t2, {
      capabilities: ["apps"],
    });
    await createRankFromPreset(page, first.slug, "Admin");
    const builder = await newUserContext(browser, baseURL!, "ow-builder");
    const guest = await newUserContext(browser, baseURL!, "ow-guest");
    const stranger = await newUserContext(browser, baseURL!, "ow-stranger");
    await inviteWithRank(page, first.slug, builder.email, /^admin$/i);
    await accept(builder.page, t1);
    await inviteWithRank(page, first.slug, guest.email, /^member$/i);
    await accept(guest.page, t1);

    // 2. Builder adds a Bay host in the first project; a machine connects
    //    and reports its inventory.
    const { id: hostId, secret } = await createHostInProject(
      builder.page,
      first.slug,
      "ow-vps",
    );
    await pushInventory(baseURL!, secret);

    // 3. Owner, who created nothing, opens its console and rotates it.
    await openSettings(page, first.slug, "ow-vps");
    await expect(page.getByTestId("bay-settings-creator")).toContainText(
      /ow-builder/,
    );
    await page.getByTestId("bay-settings-rotate").click();
    await confirmDialog(page, "Rotate");
    await expect(page.getByTestId("my-host-secret-dialog")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await releasePointerEvents(page);

    // 4. Guest reads the console, and is refused a rotation naming the rank
    //    and the permission.
    expect((await call(guest.page, "getHost", "GET", { hostId })).status).toBe(
      200,
    );
    const refused = await call(guest.page, "rotateHost", "POST", {
      hostId,
    });
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).toMatch(/host:update/);

    // 5. Somebody in neither project is refused on the host's id.
    expect(
      (await call(stranger.page, "getHost", "GET", { hostId })).status,
    ).toBe(403);
    await stranger.ctx.close();

    // 6. Builder may not lend it to the second project, which they are not
    //    in; the owner can.
    expect(
      (
        await call(
          builder.page,
          "attachHost",
          "POST",
          { projectId: second.id },
          { hostId },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          page,
          "attachHost",
          "POST",
          { projectId: second.id },
          { hostId },
        )
      ).status,
    ).toBe(200);

    // 7. Owner removes Builder from the project: the host stays, still lent.
    const members = await call(page, "getOrganizationMembers", "GET", {
      organizationId: first.organizationId,
    });
    const builderRow = (members.body as Array<{ userId: string }>).find((row) =>
      JSON.stringify(row).includes(builder.email),
    );
    expect(builderRow).toBeDefined();
    expect(
      (
        await call(page, "removeOrganizationMember", "DELETE", {
          organizationId: first.organizationId,
          userId: builderRow!.userId,
        })
      ).status,
    ).toBeLessThan(300);
    const stillThere = await call(page, "getHost", "GET", { hostId });
    expect(stillThere.status).toBe(200);
    expect(
      (stillThere.body.projects as Array<{ id: number }>).map((p) => p.id),
    ).toEqual(expect.arrayContaining([first.id, second.id]));

    // 8. Builder deletes their account: the host and its loans survive.
    const deleted = await call(
      builder.page,
      "deleteMyAccount",
      "DELETE",
      {},
      {
        confirm: builder.email,
        currentPassword: "GoodPassw0rd",
      },
    );
    expect(deleted.status).toBeLessThan(300);
    await builder.ctx.close();
    const survived = await call(page, "getHost", "GET", { hostId });
    expect(survived.status).toBe(200);
    expect(survived.body.projects).toHaveLength(2);

    // 9. The first project cannot be deleted, keeps its slug, and keeps Apps.
    const notDeleted = await call(page, "deleteProjectById", "POST", {
      id: first.id,
    });
    expect(notDeleted.status).toBe(409);
    expect(JSON.stringify(notDeleted.body)).toContain("ow-vps");
    expect(
      (await call(page, "getProjectBySlug", "GET", { slug: first.slug }))
        .status,
    ).toBe(200);
    const appsOff = await call(
      page,
      "setCapability",
      "PUT",
      { projectId: first.id, key: "apps" },
      { enabled: false },
    );
    expect(appsOff.status).toBe(409);

    // 10. Owner moves it to the second project: slug, machine and both loans
    //     unchanged.
    const moved = await call(
      page,
      "moveHost",
      "POST",
      { hostId },
      { projectId: second.id },
    );
    expect(moved.status).toBe(200);
    expect(moved.body.host.slug).toBe("ow-vps");
    expect(
      (moved.body.loans as Array<{ id: number }>).map((loan) => loan.id),
    ).toEqual([first.id, second.id]);

    // 11. Now the first project deletes. Its loan went with it.
    expect(
      (await call(page, "deleteProjectById", "POST", { id: first.id })).status,
    ).toBe(200);

    // 12. A third project; the admin assigns the host to it from the
    //     admin page, and its members can then manage it.
    const third = await createProjectViaWizard(page, t3, {
      capabilities: ["apps"],
    });
    const adminCtx = await browser.newContext({ baseURL });
    const admin = await adminCtx.newPage();
    try {
      await signInAsAdmin(admin);
      await admin.goto("/admin/hosts");
      await admin.waitForLoadState("networkidle");
      const row = admin.locator("tbody tr", {
        has: admin.getByText("ow-vps", { exact: true }),
      });
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.getByRole("button", { name: /actions/i }).click();
      await admin.getByRole("menuitem", { name: "Assign to project" }).click();
      await admin.getByTestId("admin-host-assign-project").click();
      await admin.getByRole("option", { name: new RegExp(`^${t3}`) }).click();
      await releasePointerEvents(admin);
      await admin.getByTestId("admin-host-assign-submit").click();
      await expect(row).toContainText(t3, { timeout: 15_000 });
    } finally {
      await adminCtx.close();
    }
    const managed = await call(page, "getHost", "GET", { hostId });
    expect(managed.body.project.id).toBe(third.id);
    expect(managed.body.can).toEqual(
      expect.arrayContaining(["host:update", "host:delete"]),
    );
    await guest.ctx.close();
  });
});
