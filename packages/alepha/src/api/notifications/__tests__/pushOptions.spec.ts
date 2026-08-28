import { Alepha, z } from "alepha";
import { AlephaApiJobs, jobExecutionEntity } from "alepha/api/jobs";
import { AlephaEmail } from "alepha/email";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSms } from "alepha/sms";
import { describe, it } from "vitest";

import {
  $notification,
  AlephaApiNotifications,
  NotificationJobs,
} from "../index.ts";

const ORG = "55555555-5555-4555-8555-555555555555";

class Templates {
  readonly reminder = $notification({
    name: "push-reminder",
    category: "reminders",
    schema: z.object({ what: z.text() }),
    email: { subject: "Reminder", body: (v) => `<p>${v.what}</p>` },
  });

  readonly bothChannels = $notification({
    name: "push-both",
    category: "reminders",
    schema: z.object({ what: z.text() }),
    email: { subject: "Reminder", body: (v) => `<p>${v.what}</p>` },
    sms: { message: (v) => `${v.what}` },
  });

  readonly executions = $repository(jobExecutionEntity);
}

const boot = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaEmail)
    .with(AlephaSms)
    .with(AlephaApiJobs)
    .with(AlephaApiNotifications);

  const templates = alepha.inject(Templates);
  await alepha.start();
  const jobName = alepha.inject(NotificationJobs).sendNotification.name;

  return {
    alepha,
    templates,
    rows: async () =>
      await templates.executions.findMany({
        where: { jobName: { eq: jobName } },
      }),
  };
};

describe("$notification.push accepts the job layer's scheduling options", () => {
  it("schedules a send for a future date", async ({ expect }) => {
    const { templates, rows } = await boot();

    await templates.reminder.push({
      contact: "a@example.com",
      variables: { what: "stretch" },
      scheduledAt: new Date("2099-01-01T09:00:00.000Z"),
    });

    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("scheduled");
    expect(all[0].scheduledAt).toBeTruthy();
  });

  it("schedules a send after a delay", async ({ expect }) => {
    const { templates, rows } = await boot();

    await templates.reminder.push({
      contact: "a@example.com",
      variables: { what: "stretch" },
      delay: [1, "hour"],
    });

    const all = await rows();
    expect(all[0].status).toBe("scheduled");
  });

  it("dedupes a repeated key while the first is still pending", async ({
    expect,
  }) => {
    const { templates, rows } = await boot();

    await templates.reminder.push({
      contact: "a@example.com",
      variables: { what: "stretch" },
      key: "quest-1-day-2",
      delay: [1, "hour"],
    });
    await templates.reminder.push({
      contact: "a@example.com",
      variables: { what: "stretch" },
      key: "quest-1-day-2",
      delay: [1, "hour"],
    });

    expect(await rows()).toHaveLength(1);
  });

  /**
   * Pins the REAL behaviour, which is not the one the name suggests. The job
   * layer clears `key` on both terminal states, so a key stops deduping the
   * moment the first send finishes. If this test ever fails, the fix is
   * almost certainly in the code and not here: an app that trusted `key` for
   * "one reminder per day" would double-mail a whole roster.
   */
  it("does NOT dedupe a repeated key once the first send completed", async ({
    expect,
  }) => {
    const { templates, rows } = await boot();

    await templates.reminder.push({
      contact: "a@example.com",
      variables: { what: "stretch" },
      key: "quest-1-day-2",
    });

    const deadline = Date.now() + 2000;
    let settled = await rows();
    while (settled[0]?.status !== "ok" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
      settled = await rows();
    }
    expect(settled[0].status).toBe("ok");

    await templates.reminder.push({
      contact: "a@example.com",
      variables: { what: "stretch" },
      key: "quest-1-day-2",
    });

    expect(await rows()).toHaveLength(2);
  });
});

describe("$notification.pushMany fans out over contacts", () => {
  it("pushes one row per contact", async ({ expect }) => {
    const { templates, rows } = await boot();

    const count = await templates.reminder.pushMany({
      contacts: [
        { contact: "a@example.com", variables: { what: "one" } },
        { contact: "b@example.com", variables: { what: "two" } },
        { contact: "c@example.com", variables: { what: "three" } },
      ],
      delay: [1, "hour"],
    });

    expect(count).toBe(3);
    expect(await rows()).toHaveLength(3);
  });

  it("pushes one row per contact per channel", async ({ expect }) => {
    const { templates, rows } = await boot();

    const count = await templates.bothChannels.pushMany({
      contacts: [
        { contact: "a@example.com", variables: { what: "one" } },
        { contact: "b@example.com", variables: { what: "two" } },
      ],
      delay: [1, "hour"],
    });

    expect(count).toBe(4);
    expect(await rows()).toHaveLength(4);
  });

  it("carries the tenant on the row AND in the payload", async ({ expect }) => {
    const { templates, rows } = await boot();

    await templates.reminder.pushMany({
      contacts: [{ contact: "a@example.com", variables: { what: "one" } }],
      organizationId: ORG,
      delay: [1, "hour"],
    });

    const [row] = await rows();
    expect(row.organizationId).toBe(ORG);
    expect((row.payload as { organizationId?: string }).organizationId).toBe(
      ORG,
    );
  });

  it("carries the tenant on the keyed path too", async ({ expect }) => {
    const { templates, rows } = await boot();

    await templates.reminder.pushMany({
      contacts: [{ contact: "a@example.com", variables: { what: "one" } }],
      organizationId: ORG,
      delay: [1, "hour"],
      key: (contact) => `daily-${contact}`,
    });

    const [row] = await rows();
    expect(row.organizationId).toBe(ORG);
    expect((row.payload as { organizationId?: string }).organizationId).toBe(
      ORG,
    );
  });

  it("takes each contact's language explicitly, with no request to read", async ({
    expect,
  }) => {
    const { templates, rows } = await boot();

    await templates.reminder.pushMany({
      contacts: [
        { contact: "a@example.com", variables: { what: "one" }, lang: "fr" },
        { contact: "b@example.com", variables: { what: "two" } },
      ],
      delay: [1, "hour"],
    });

    const all = await rows();
    const langs = all.map((row) => (row.payload as { lang?: string }).lang);
    expect(langs).toContain("fr");
    expect(langs).toContain(undefined);
  });

  it("does not throw when called with no request context", async ({
    expect,
  }) => {
    const { templates } = await boot();

    await expect(
      templates.reminder.pushMany({
        contacts: [{ contact: "a@example.com", variables: { what: "one" } }],
        delay: [1, "hour"],
      }),
    ).resolves.toBe(1);
  });

  it("does nothing for an empty contact list", async ({ expect }) => {
    const { templates, rows } = await boot();

    expect(await templates.reminder.pushMany({ contacts: [] })).toBe(0);
    expect(await rows()).toHaveLength(0);
  });
});
