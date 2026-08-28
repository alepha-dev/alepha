import { Alepha, z } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaServer, ServerProvider } from "alepha/server";
import { AlephaSms } from "alepha/sms";
import { describe, it } from "vitest";

import {
  $notification,
  AlephaApiNotifications,
  NotificationIngestService,
  NotificationSenderService,
  NotificationSuppressionService,
} from "../index.ts";

const SECRET = "brevo-webhook-secret";

class Templates {
  readonly reminder = $notification({
    name: "ingest-reminder",
    category: "reminders",
    schema: z.object({}),
    email: { subject: "Reminder", body: "<p>Do the thing</p>" },
  });

  readonly reset = $notification({
    name: "ingest-reset",
    category: "security",
    critical: true,
    schema: z.object({}),
    email: { subject: "Reset", body: "<p>Code</p>" },
  });
}

const boot = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", BREVO_WEBHOOK_SECRET: SECRET },
  })
    .with(AlephaOrmPostgres)
    .with(AlephaEmail)
    .with(AlephaSms)
    .with(AlephaServer)
    .with(AlephaApiJobs)
    .with(AlephaApiNotifications);

  const templates = alepha.inject(Templates);
  await alepha.start();

  const sender = alepha.inject(NotificationSenderService);
  const mail = alepha.inject(MemoryEmailProvider);

  /**
   * Send one message and hand back the id a later event would carry.
   */
  const sendAndCapture = async (executionId: string) => {
    await sender.send(
      {
        type: "email",
        template: "ingest-reminder",
        contact: "a@example.com",
        variables: {},
        category: "reminders",
      },
      { executionId },
    );
    return mail.last!.messageId;
  };

  return {
    alepha,
    templates,
    sender,
    mail,
    sendAndCapture,
    ingest: alepha.inject(NotificationIngestService),
    suppressions: alepha.inject(NotificationSuppressionService),
    hostname: alepha.inject(ServerProvider).hostname,
  };
};

const cloudflareEvent = (
  suffix: string,
  messageId: string,
  bounce?: "hard" | "soft",
) => ({
  type: `cf.email.sending.message.${suffix}`,
  source: { type: "email.sending", domain: "example.com" },
  payload: {
    eventId: "evt-1",
    messageId,
    recipient: "a@example.com",
    ...(bounce ? { bounce: { type: bounce, reason: "because" } } : {}),
    delivery: { smtpStatusCode: "5.1.1" },
  },
  metadata: { eventTimestamp: "2026-08-27T10:00:00.000Z" },
});

describe("bounce and complaint ingestion", () => {
  it("suppresses an address that hard bounced", async ({ expect }) => {
    const { alepha, suppressions, sendAndCapture } = await boot();
    const messageId = await sendAndCapture("ing-1");

    await alepha.events.emit(
      "cloudflare:queue",
      cloudflareEvent("bounced", messageId, "hard") as never,
    );

    const rows = await suppressions.list({});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      contact: "a@example.com",
      reason: "bounced",
      source: "cloudflare",
    });

    await alepha.stop();
  });

  it("does NOT suppress a soft bounce", async ({ expect }) => {
    const { alepha, suppressions, sendAndCapture } = await boot();
    const messageId = await sendAndCapture("ing-2");

    await alepha.events.emit(
      "cloudflare:queue",
      cloudflareEvent("bounced", messageId, "soft") as never,
    );

    expect(await suppressions.list({})).toHaveLength(0);

    await alepha.stop();
  });

  it("does not suppress on delivered or deferred", async ({ expect }) => {
    const { alepha, suppressions, sendAndCapture } = await boot();
    const messageId = await sendAndCapture("ing-3");

    await alepha.events.emit(
      "cloudflare:queue",
      cloudflareEvent("delivered", messageId) as never,
    );
    await alepha.events.emit(
      "cloudflare:queue",
      cloudflareEvent("deferred", messageId) as never,
    );

    expect(await suppressions.list({})).toHaveLength(0);

    await alepha.stop();
  });

  it("a complaint blocks even critical mail afterwards", async ({ expect }) => {
    const { alepha, sender, mail, sendAndCapture } = await boot();
    const messageId = await sendAndCapture("ing-4");

    await alepha.events.emit(
      "cloudflare:queue",
      cloudflareEvent("complained", messageId) as never,
    );

    const before = mail.records.length;
    await sender.send(
      {
        type: "email",
        template: "ingest-reset",
        contact: "a@example.com",
        variables: {},
        category: "security",
        critical: true,
      },
      { executionId: "ing-4b" },
    );

    expect(mail.records).toHaveLength(before);

    await alepha.stop();
  });

  it("replaying the same event leaves one suppression", async ({ expect }) => {
    const { alepha, suppressions, sendAndCapture } = await boot();
    const messageId = await sendAndCapture("ing-5");
    const event = cloudflareEvent("bounced", messageId, "hard");

    await alepha.events.emit("cloudflare:queue", event as never);
    await alepha.events.emit("cloudflare:queue", event as never);

    expect(await suppressions.list({})).toHaveLength(1);

    await alepha.stop();
  });

  it("writes nothing for a messageId with no receipt", async ({ expect }) => {
    const { alepha, suppressions } = await boot();

    await alepha.events.emit(
      "cloudflare:queue",
      cloudflareEvent("bounced", "never-issued", "hard") as never,
    );

    expect(await suppressions.list({})).toHaveLength(0);

    await alepha.stop();
  });

  it("ignores alepha's own queue envelope", async ({ expect }) => {
    const { alepha, suppressions } = await boot();

    await alepha.events.emit("cloudflare:queue", {
      queue: "jobs",
      message: "whatever",
    } as never);

    expect(await suppressions.list({})).toHaveLength(0);

    await alepha.stop();
  });
});

describe("brevo webhook", () => {
  it("refuses a call with no secret", async ({ expect }) => {
    const { alepha, hostname, suppressions } = await boot();

    const res = await fetch(`${hostname}/notifications/webhooks/brevo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "hardBounce" }),
    });

    expect(res.status).toBe(401);
    expect(await suppressions.list({})).toHaveLength(0);

    await alepha.stop();
  });

  it("suppresses on a hard bounce it can attribute", async ({ expect }) => {
    const { alepha, hostname, suppressions, sendAndCapture } = await boot();
    const messageId = await sendAndCapture("ing-6");

    const res = await fetch(
      `${hostname}/notifications/webhooks/brevo?secret=${SECRET}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event: "hardBounce",
          email: "a@example.com",
          "message-id": messageId,
          id: 42,
        }),
      },
    );

    expect(res.status).toBe(200);
    expect(await suppressions.list({})).toHaveLength(1);

    await alepha.stop();
  });

  it("acks an event type it does not act on", async ({ expect }) => {
    const { alepha, hostname, suppressions } = await boot();

    const res = await fetch(
      `${hostname}/notifications/webhooks/brevo?secret=${SECRET}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: "opened", email: "a@example.com" }),
      },
    );

    expect(res.status).toBe(200);
    expect(await suppressions.list({})).toHaveLength(0);

    await alepha.stop();
  });
});
