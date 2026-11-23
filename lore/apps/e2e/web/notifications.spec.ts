import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import {
  apiPath,
  createProjectViaWizard,
  newUserContext,
  openAccount,
  pickSelectOption,
  registerAndVerify,
  signInAsAdmin,
} from "./_helpers.ts";

/**
 * Notifications, end to end (#Q3892): a manager notifies another member of
 * a monitor going down from Settings > Notifications, the monitor goes
 * down, and the member's inbox shows it while the manager's does not; the
 * table lists the row under Monitors and holds at phone width.
 *
 * An HTTP monitor stands in for a host: a host goes offline only after five
 * minutes of grace, an HTTP monitor on its first failed check.
 */
test.describe("Notifications", () => {
  test("a manager notifies another member of a monitor going down, and only that member is told", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    await registerAndVerify(
      page,
      `notify-owner-${crypto.randomUUID()}@example.com`,
      "GoodPassw0rd",
    );
    const { id, slug } = await createProjectViaWizard(page, "Notify others", {
      capabilities: ["ship"],
      options: { ship: ["uptime"] },
    });
    const member = await newUserContext(browser, baseURL!, "notify-member");
    try {
      await inviteAndAccept(page, member, slug);

      const app = await page.request.post(`/api/projects/${id}/apps`, {
        data: { app: "web", env: "production" },
      });
      expect(app.ok(), await app.text()).toBe(true);
      const appInstanceId = ((await app.json()) as { id: string }).id;
      const missing = `${baseURL}/api/e2e-no-such-endpoint`;
      const made = await page.request.post(`/api/projects/${id}/monitors`, {
        data: {
          appInstanceId,
          name: "Web probe",
          kind: "http",
          target: `${baseURL}/`,
          intervalSecs: 60,
          timeoutSecs: 5,
          confirmations: 1,
          expect: {},
        },
      });
      expect(made.ok(), await made.text()).toBe(true);
      const monitorId = ((await made.json()) as { monitor: { id: string } })
        .monitor.id;

      // The member's id, from the project's own member list.
      const users = (await (
        await page.request.get(`/api/getProjectUsers/${id}`)
      ).json()) as Array<{ id: string; email?: string }>;
      const memberId = users.find((it) => it.email === member.email)!.id;

      // The manager notifies the member, not themself, of the outage.
      await page.goto(`/${slug}/settings/notifications`);
      await expect(page.getByTestId("notifications-settings")).toBeVisible();
      const set = await page.request.post(`/api/projects/${id}/subscriptions`, {
        data: {
          event: "monitor.down",
          filter: monitorId,
          memberId,
          channels: ["inapp"],
        },
      });
      expect(set.ok(), await set.text()).toBe(true);
      await page.reload();
      await expect(
        page.getByTestId("notification-event-monitor.down"),
      ).toHaveCount(1);

      // The grouping is remembered as the filters are (#Q4192): chosen,
      // then still chosen after a reload.
      await pickSelectOption(page, "notifications-group-by", "By recipient");
      await page.reload();
      await expect(page.getByTestId("notifications-group-by")).toContainText(
        "By recipient",
        { timeout: 15_000 },
      );

      // At phone width the page fits.
      await page.setViewportSize({ width: 375, height: 812 });
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(overflows).toBe(false);
      await page.setViewportSize({ width: 1280, height: 800 });

      // The monitor goes down.
      const admin = await browser.newContext({ baseURL });
      try {
        const adminPage = await admin.newPage();
        await signInAsAdmin(adminPage);
        await adminPage.goto("/admin/jobs/uptime.tick");
        const trigger = await apiPath(adminPage, "triggerJob");
        const updated = await page.request.put(`/api/monitors/${monitorId}`, {
          data: {
            name: "Web probe",
            kind: "http",
            target: missing,
            intervalSecs: 60,
            timeoutSecs: 5,
            confirmations: 1,
            expect: {},
          },
        });
        expect(updated.ok(), await updated.text()).toBe(true);
        for (const active of [false, true]) {
          const res = await page.request.put(
            `/api/monitors/${monitorId}/active`,
            { data: { active } },
          );
          expect(res.ok(), await res.text()).toBe(true);
        }
        await expect
          .poll(
            async () => {
              const res = await adminPage.request.post(
                trigger.replace(":name", "uptime.tick"),
                { data: {} },
              );
              expect(res.ok(), await res.text()).toBe(true);
              const list = (await (
                await page.request.get(`/api/projects/${id}/monitors`)
              ).json()) as { items: Array<{ id: string; status: string }> };
              return list.items.find((row) => row.id === monitorId)?.status;
            },
            { timeout: 30_000 },
          )
          .toBe("down");
      } finally {
        await admin.close();
      }

      // The member is told; the manager is not.
      await inbox(member.page, slug, "Web probe is down");
      const own = await page.evaluate(async () => {
        const r = await fetch("/api/inbox", { credentials: "include" });
        const body = (await r.json()) as { items?: { title?: string }[] };
        return (body.items ?? []).map((it) => it.title);
      });
      expect(own).not.toContain("Web probe is down");
    } finally {
      await member.ctx.close();
    }
  });
});

const inbox = async (viewer: Page, slug: string, text: string) => {
  await expect(async () => {
    await viewer.goto(`/${slug}/apps`);
    await viewer
      .getByRole("button", { name: /notifications/i })
      .first()
      .click();
    await expect(viewer.getByText(text).first()).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 60_000 });
};

/**
 * The invite/accept block of `inbox.spec.ts`.
 */
const inviteAndAccept = async (
  owner: Page,
  member: { page: Page; email: string },
  slug: string,
): Promise<void> => {
  await owner.goto(`/${slug}/settings/members`);
  await owner.waitForLoadState("domcontentloaded");
  await owner.getByRole("button", { name: /^invite$/i }).click();
  await owner.getByPlaceholder("user@example.com").fill(member.email);
  const invited = owner.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/invitations"),
    { timeout: 20_000 },
  );
  await owner.getByRole("button", { name: /send invitation/i }).click();
  expect((await invited).ok()).toBe(true);
  await expect(async () => {
    const entries = await member.page.evaluate(async () => {
      const r = await fetch("/api/inbox", { credentials: "include" });
      const page = (await r.json()) as { items?: { href?: string }[] };
      return (page.items ?? []).map((it) => it.href);
    });
    expect(entries).toContain("/?account=invitations");
  }).toPass({ timeout: 60_000 });
  await openAccount(member.page, "invitations");
  await member.page.waitForLoadState("domcontentloaded");
  const accepted = member.page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/api\/invitations\/[^/]+\/accept$/.test(r.url()),
    { timeout: 20_000 },
  );
  await member.page.getByRole("button", { name: /^accept$/i }).click();
  expect((await accepted).ok()).toBe(true);
};
