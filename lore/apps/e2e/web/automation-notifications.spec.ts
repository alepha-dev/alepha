import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import {
  apiPath,
  createProjectViaWizard,
  registerAndVerify,
  signInAsAdmin,
} from "./_helpers.ts";

interface Run {
  id: string;
  occurrenceId: string;
  status: string;
}
interface RunEvidence {
  notifications: Array<{ index: number; status: string }>;
}

/**
 * Every notification through automations (#E148, #Q3616), end to end: a
 * monitor's bell, an outage and a recovery in the inbox, a Discord channel
 * posting once, its deletion leaving the rule on the inbox, and a disabled
 * rule sending nothing more.
 *
 * The e2e server runs with `DISCORD_TRANSPORT=memory`, so the channel's test
 * post and its deliveries never reach discord.com. An HTTP monitor stands in
 * for the push monitor the quest names: a push monitor goes down only after
 * 60 s of real silence, an HTTP one on its first failed check.
 */
test.describe("Every notification through automations", () => {
  test("a monitor bell reports an outage and a recovery, a Discord channel posts once, deleting it keeps the inbox, and a disabled rule sends nothing", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    await registerAndVerify(
      page,
      `bells-${crypto.randomUUID()}@example.com`,
      "GoodPassw0rd",
    );
    const { id, slug } = await createProjectViaWizard(
      page,
      "Bells and channels",
      { capabilities: ["ship"], options: { ship: ["uptime"] } },
    );

    const app = await page.request.post(`/api/projects/${id}/apps`, {
      data: { app: "web", env: "production" },
    });
    expect(app.ok(), await app.text()).toBe(true);
    const appInstanceId = ((await app.json()) as { id: string }).id;
    const missing = `${baseURL}/api/e2e-no-such-endpoint`;
    const config = (target: string) => ({
      name: "Web probe",
      kind: "http",
      target,
      intervalSecs: 60,
      timeoutSecs: 5,
      confirmations: 1,
      expect: {},
    });
    const made = await page.request.post(`/api/projects/${id}/monitors`, {
      data: { appInstanceId, ...config(missing) },
    });
    expect(made.ok(), await made.text()).toBe(true);
    const monitorId = ((await made.json()) as { monitor: { id: string } })
      .monitor.id;

    // The bell on the app's Uptime tab: one automation of the viewer's own
    // (#Q3808), in-app, with a source on the outage and one on the recovery.
    await page.goto(`/${slug}/apps/web/production/uptime`);
    const bell = page.getByTestId("monitor-subscription-bell");
    await expect(bell).toBeEnabled();
    await bell.click();
    await page.getByTestId("automation-subscription-confirm").click();
    await expect(bell).toHaveAttribute("aria-pressed", "true");
    const rules = (await (
      await page.request.get(`/api/projects/${id}/automations`)
    ).json()) as { items: Array<{ id: string; title: string }> };
    expect(rules.items).toHaveLength(1);
    expect(rules.items[0].title).toMatch(/^Uptime alerts: /);
    const automation = `/api/projects/${id}/automations/${rules.items[0].id}`;
    // The bell's dialog opens the automation it made (#Q3812).
    await bell.click();
    await page.getByTestId("automation-subscription-open").click();
    await expect(page).toHaveURL(
      new RegExp(`/${slug}/automations/${rules.items[0].id}$`),
    );
    // Each event's runs, by the source that started them (#Q3807).
    const down = "monitor-down.source";
    const up = "monitor-up.source";

    const admin = await browser.newContext({ baseURL });
    try {
      const adminPage = await admin.newPage();
      await signInAsAdmin(adminPage);
      await adminPage.goto("/admin/jobs/uptime.tick");
      const trigger = await apiPath(adminPage, "triggerJob");
      const job = async (name: string) => {
        const res = await adminPage.request.post(
          trigger.replace(":name", name),
          { data: {} },
        );
        expect(res.ok(), await res.text()).toBe(true);
      };
      /**
       * Points the monitor at `target`, checks it now (a pause and a resume
       * make it due), and waits for the status the check gives.
       */
      const check = async (target: string, status: "down" | "up") => {
        const updated = await page.request.put(`/api/monitors/${monitorId}`, {
          data: config(target),
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
              await job("uptime.tick");
              const list = (await (
                await page.request.get(`/api/projects/${id}/monitors`)
              ).json()) as { items: Array<{ id: string; status: string }> };
              return list.items.find((row) => row.id === monitorId)?.status;
            },
            { timeout: 30_000 },
          )
          .toBe(status);
      };
      const runs = async (source: string): Promise<Run[]> =>
        (
          (await (
            await page.request.get(`${automation}/runs?source=${source}`)
          ).json()) as {
            items: Run[];
          }
        ).items.filter((run) => run.occurrenceId.startsWith("event:"));
      /**
       * Dispatches until the rule holds `count` event runs, every one
       * finished, and returns the newest one's delivery evidence.
       */
      const settled = async (
        source: string,
        count: number,
      ): Promise<RunEvidence> => {
        let latest: Run | undefined;
        await expect
          .poll(
            async () => {
              // One pass reserves events, the next queues the ready worker.
              await job("automations.dispatch");
              await job("automations.dispatch");
              const all = await runs(source);
              latest = all[0];
              return (
                all.length === count &&
                all.every((run) => run.status === "succeeded")
              );
            },
            { timeout: 40_000 },
          )
          .toBe(true);
        const runPath = `/api/projects/${id}/automation-runs/${latest!.id}`;
        let evidence: RunEvidence = { notifications: [] };
        await expect
          .poll(
            async () => {
              evidence = (await (
                await page.request.get(runPath)
              ).json()) as RunEvidence;
              return (
                evidence.notifications.length > 0 &&
                evidence.notifications.every((it) =>
                  ["sent", "delivered"].includes(it.status),
                )
              );
            },
            { timeout: 20_000 },
          )
          .toBe(true);
        return evidence;
      };
      const inbox = async (viewer: Page, text: string) => {
        await expect(async () => {
          await viewer.goto(`/${slug}/apps`);
          await viewer
            .getByRole("button", { name: /notifications/i })
            .first()
            .click();
          await expect(viewer.getByText(text).first()).toBeVisible({
            timeout: 2_000,
          });
        }).toPass({ timeout: 30_000 });
      };

      // An outage, then its recovery, each in the inbox.
      await check(missing, "down");
      expect((await settled(down, 1)).notifications).toHaveLength(1);
      await inbox(page, "Web probe is down");
      await check(`${baseURL}/`, "up");
      expect((await settled(up, 1)).notifications).toHaveLength(1);
      await inbox(page, "Web probe recovered");

      // A Discord channel, added in Settings: its test post goes to memory.
      await page.goto(`/${slug}/automations/channels`);
      await page
        .getByRole("button", { name: "Add a channel", exact: true })
        .click();
      const form = page.getByTestId("notification-channel-form");
      await form.getByRole("textbox", { name: "Name" }).fill("alerts");
      await form
        .getByRole("textbox", { name: "Discord webhook URL" })
        .fill("https://discord.com/api/webhooks/1234567890/e2e-token_value");
      await form.getByRole("button", { name: "Save", exact: true }).click();
      const row = page.getByTestId("notification-channel-alerts");
      await expect(row).toBeVisible();
      await expect(row).not.toContainText("e2e-token_value");
      const channels = (await (
        await page.request.get(`/api/projects/${id}/channels`)
      ).json()) as { items: Array<{ id: string; name: string }> };
      const discord = channels.items.find((it) => it.name === "alerts")!;
      expect(JSON.stringify(channels)).not.toContain("e2e-token_value");

      // The outage's notification also posts there: one delivery per channel.
      const read = async () =>
        (await (await page.request.get(automation)).json()) as {
          revision: number;
          title: string;
          enabled: boolean;
          health: string;
          rule: {
            nodes: Array<{
              id: string;
              config: { channels?: string[] } & Record<string, unknown>;
            }>;
          } & Record<string, unknown>;
        };
      const before = await read();
      const rule = structuredClone(before.rule);
      rule.nodes.find(
        (node) => node.id === "monitor-down.action-1",
      )!.config.channels = ["inbox", discord.id];
      const edited = await page.request.put(automation, {
        data: {
          title: before.title,
          rule,
          expectedRevision: before.revision,
        },
      });
      expect(edited.ok(), await edited.text()).toBe(true);
      await check(missing, "down");
      const posted = await settled(down, 2);
      expect(posted.notifications).toHaveLength(2);

      // Deleting the channel strips it from the rule, which keeps its inbox.
      await page.goto(`/${slug}/automations/channels`);
      await row.getByRole("button", { name: "Delete", exact: true }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Delete", exact: true })
        .click();
      await expect(row).toHaveCount(0);
      const kept = await read();
      expect(kept.enabled).toBe(true);
      expect(kept.health).toBe("active");
      expect(
        kept.rule.nodes.find((node) => node.id === "monitor-down.action-1")
          ?.config.channels,
      ).toEqual(["inbox"]);
      await check(`${baseURL}/`, "up");
      await settled(up, 2);
      await check(missing, "down");
      expect((await settled(down, 3)).notifications).toHaveLength(1);

      // Disabled on the Automations page, the automation sends nothing more,
      // from either source: the bell is one automation (#Q3808).
      await page.goto(`/${slug}/automations`);
      const listed = page.getByRole("row").filter({ hasText: kept.title });
      await listed.getByRole("button", { name: "Open row actions" }).click();
      await page
        .getByRole("menu")
        .getByRole("menuitem", { name: "Disable", exact: true })
        .click();
      await expect(listed.getByText("Disabled", { exact: true })).toBeVisible();
      await check(`${baseURL}/`, "up");
      await check(missing, "down");
      for (let index = 0; index < 3; index++) await job("automations.dispatch");
      expect(await runs(up)).toHaveLength(2);
      expect(await runs(down)).toHaveLength(3);
    } finally {
      await admin.close();
    }
  });
});
