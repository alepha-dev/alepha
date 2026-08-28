import { Alepha, z } from "alepha";
import { AlephaApiJobs, jobExecutionEntity } from "alepha/api/jobs";
import {
  AlephaEmail,
  EmailProvider,
  MemoryEmailProvider,
  type EmailSendOptions,
  type EmailSendResult,
} from "alepha/email";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSms } from "alepha/sms";
import { describe, it } from "vitest";

import {
  $notification,
  AlephaApiNotifications,
  NotificationDeliveryService,
  NotificationSenderService,
  NotificationSuppressionService,
} from "../index.ts";

class ExplodingEmailProvider implements EmailProvider {
  public async send(_options: EmailSendOptions): Promise<EmailSendResult> {
    throw new Error("provider is on fire");
  }
}

class Templates {
  readonly reminder = $notification({
    name: "rcpt-reminder",
    category: "reminders",
    schema: z.object({}),
    email: { subject: "Reminder", body: "<p>Do the thing</p>" },
  });

  readonly reset = $notification({
    name: "rcpt-reset",
    category: "security",
    critical: true,
    sensitive: true,
    schema: z.object({ code: z.text() }),
    email: {
      subject: "Your code",
      body: (v) => `<p>${v.code}</p>`,
    },
  });

  readonly executions = $repository(jobExecutionEntity);
}

const boot = async (
  configure?: (alepha: ReturnType<typeof Alepha.create>) => void,
) => {
  const alepha = Alepha.create();

  // Before every module. `AlephaEmail` substitutes `EmailProvider` with the
  // memory one in test mode, and the container refuses a second
  // substitution once the first has been used.
  configure?.(alepha);

  alepha
    .with(AlephaOrmPostgres)
    .with(AlephaEmail)
    .with(AlephaSms)
    .with(AlephaApiJobs)
    .with(AlephaApiNotifications);

  const templates = alepha.inject(Templates);
  await alepha.start();

  return {
    alepha,
    templates,
    sender: alepha.inject(NotificationSenderService),
    deliveries: alepha.inject(NotificationDeliveryService),
    suppressions: alepha.inject(NotificationSuppressionService),
    // A getter, not a field: the tests that substitute a throwing provider
    // never register the memory one, and injecting it eagerly would fail
    // them on the setup rather than on what they are testing.
    get mail() {
      return alepha.inject(MemoryEmailProvider);
    },
  };
};

const payload = (template: string, extra: Record<string, unknown> = {}) => ({
  type: "email" as const,
  template,
  contact: "a@example.com",
  variables: {},
  category: "reminders",
  ...extra,
});

describe("delivery receipts", () => {
  it("writes a sent receipt carrying the provider's message id", async ({
    expect,
  }) => {
    const { sender, deliveries, mail } = await boot();

    await sender.send(payload("rcpt-reminder"), { executionId: "exec-1" });

    const [receipt] = await deliveries.list({});
    expect(receipt).toMatchObject({
      executionId: "exec-1",
      status: "sent",
      channel: "email",
      contact: "a@example.com",
      template: "rcpt-reminder",
      subject: "Reminder",
    });
    expect(receipt.messageId).toBe(mail.last?.messageId);
  });

  it("writes a skipped receipt with the reason when the gate refuses", async ({
    expect,
  }) => {
    const { sender, deliveries, suppressions } = await boot();
    await suppressions.suppress({
      contact: "a@example.com",
      channel: "email",
      reason: "bounced",
      source: "cloudflare",
    });

    await sender.send(payload("rcpt-reminder"), { executionId: "exec-2" });

    const [receipt] = await deliveries.list({});
    expect(receipt).toMatchObject({
      status: "skipped",
      skipReason: "suppressed",
    });
    expect(receipt.messageId ?? null).toBeNull();
  });

  it("writes a failed receipt AND rethrows when the provider throws", async ({
    expect,
  }) => {
    const { sender, deliveries } = await boot((alepha) => {
      alepha.with({
        provide: EmailProvider,
        use: ExplodingEmailProvider,
      });
    });

    await expect(
      sender.send(payload("rcpt-reminder"), { executionId: "exec-3" }),
    ).rejects.toThrow(/on fire/);

    const [receipt] = await deliveries.list({});
    expect(receipt).toMatchObject({ status: "failed", executionId: "exec-3" });
    expect(receipt.error).toContain("on fire");
  });

  it("settles ONE receipt across retries of the same execution", async ({
    expect,
  }) => {
    const { sender, deliveries } = await boot((alepha) => {
      alepha.with({
        provide: EmailProvider,
        use: ExplodingEmailProvider,
      });
    });

    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(
        sender.send(payload("rcpt-reminder"), { executionId: "exec-4" }),
      ).rejects.toThrow();
    }

    expect(await deliveries.list({})).toHaveLength(1);
  });

  it("stores no subject for a sensitive template", async ({ expect }) => {
    const { sender, deliveries } = await boot();

    await sender.send(
      payload("rcpt-reset", {
        critical: true,
        sensitive: true,
        category: "security",
        variables: { code: "123456" },
      }),
      { executionId: "exec-5" },
    );

    const [receipt] = await deliveries.list({});
    expect(receipt.status).toBe("sent");
    expect(receipt.subject ?? null).toBeNull();
    expect(receipt.body ?? null).toBeNull();
  });

  it("does not store the body unless the parameter says so", async ({
    expect,
  }) => {
    const { sender, deliveries } = await boot();

    await sender.send(payload("rcpt-reminder"), { executionId: "exec-6" });

    const [receipt] = await deliveries.list({});
    expect(receipt.body ?? null).toBeNull();
  });

  it("still sends when the receipt cannot be written", async ({ expect }) => {
    const { sender, deliveries, mail } = await boot();

    // A receipt-write failure must never propagate: if it did, the job would
    // retry and the mail would go out twice.
    (deliveries as unknown as { record: () => Promise<void> }).record =
      async () => {
        throw new Error("receipt store is down");
      };

    await sender.send(payload("rcpt-reminder"), { executionId: "exec-7" });

    expect(mail.records).toHaveLength(1);
  });
});

describe("delivery events", () => {
  it("flips a receipt's status by messageId", async ({ expect }) => {
    const { alepha, sender, deliveries, mail } = await boot();
    await sender.send(payload("rcpt-reminder"), { executionId: "exec-8" });
    const messageId = mail.last!.messageId;

    await alepha.events.emit("notification:delivery", {
      provider: "memory",
      messageId,
      contact: "a@example.com",
      channel: "email",
      status: "delivered",
      raw: {},
      occurredAt: new Date().toISOString(),
    });

    const [receipt] = await deliveries.list({});
    expect(receipt.status).toBe("delivered");
    expect(receipt.lastEventAt).toBeTruthy();
  });

  it("records a hard bounce on the receipt", async ({ expect }) => {
    const { alepha, sender, deliveries, mail } = await boot();
    await sender.send(payload("rcpt-reminder"), { executionId: "exec-9" });

    await alepha.events.emit("notification:delivery", {
      provider: "memory",
      messageId: mail.last!.messageId,
      contact: "a@example.com",
      channel: "email",
      status: "bounced",
      bounce: "hard",
      smtpStatusCode: "5.1.1",
      raw: {},
      occurredAt: new Date().toISOString(),
    });

    const [receipt] = await deliveries.list({});
    expect(receipt.status).toBe("bounced");
    expect(receipt.smtpStatusCode).toBe("5.1.1");
  });

  it("changes nothing for a messageId it has never seen", async ({
    expect,
  }) => {
    const { alepha, sender, deliveries } = await boot();
    await sender.send(payload("rcpt-reminder"), { executionId: "exec-10" });

    await alepha.events.emit("notification:delivery", {
      provider: "memory",
      messageId: "never-issued",
      contact: "someone@example.com",
      channel: "email",
      status: "bounced",
      bounce: "hard",
      raw: {},
      occurredAt: new Date().toISOString(),
    });

    const [receipt] = await deliveries.list({});
    expect(receipt.status).toBe("sent");
  });
});
