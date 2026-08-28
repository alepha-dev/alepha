import { Alepha, z } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSms, MemorySmsProvider } from "alepha/sms";
import { describe, it } from "vitest";

import {
  $notification,
  AlephaApiNotifications,
  NotificationSenderService,
} from "../index.ts";

/**
 * A notification body may be produced asynchronously, so that a template can
 * be rendered by something that has to be awaited (a React component through
 * `alepha/react/email`, a fetch, a storage read).
 *
 * The two sync shapes - a plain string and a function returning a string -
 * keep working untouched: every template in the tree uses one of them.
 */
class Templates {
  readonly asyncEmail = $notification({
    name: "async-email",
    schema: z.object({ name: z.text() }),
    email: {
      subject: "Async body",
      body: async (vars) => `Hello ${vars.name}`,
    },
  });

  readonly asyncSms = $notification({
    name: "async-sms",
    schema: z.object({ name: z.text() }),
    sms: {
      message: async (vars) => `Hi ${vars.name}`,
    },
  });

  readonly syncFnEmail = $notification({
    name: "sync-fn-email",
    schema: z.object({ name: z.text() }),
    email: {
      subject: "Sync fn body",
      body: (vars) => `Hello ${vars.name}`,
    },
  });

  readonly stringEmail = $notification({
    name: "string-email",
    schema: z.object({ name: z.text() }),
    email: {
      subject: "String body",
      body: "<p>Static</p>",
    },
  });

  readonly syncFnSms = $notification({
    name: "sync-fn-sms",
    schema: z.object({ name: z.text() }),
    sms: {
      message: (vars) => `Hi ${vars.name}`,
    },
  });
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

  return { alepha, templates };
};

describe("notification bodies may be asynchronous", () => {
  it("resolves an email body that returns a promise", async ({ expect }) => {
    const { alepha } = await boot();
    const sender = alepha.inject(NotificationSenderService);

    const rendered = await sender.renderEmail({
      type: "email",
      template: "async-email",
      contact: "alice@example.com",
      variables: { name: "Alice" },
    });

    expect(rendered.body).toBe("Hello Alice");
    expect(rendered.subject).toBe("Async body");
    expect(rendered.to).toBe("alice@example.com");
  });

  it("resolves an sms message that returns a promise", async ({ expect }) => {
    const { alepha } = await boot();
    const sender = alepha.inject(NotificationSenderService);

    const rendered = await sender.renderSms({
      type: "sms",
      template: "async-sms",
      contact: "+33600000000",
      variables: { name: "Alice" },
    });

    expect(rendered.message).toBe("Hi Alice");
    expect(rendered.to).toBe("+33600000000");
  });

  it("delivers an awaited email body end to end", async ({ expect }) => {
    const { alepha, templates } = await boot();

    await templates.asyncEmail.push({
      contact: "bob@example.com",
      variables: { name: "Bob" },
    });

    const mail = alepha.inject(MemoryEmailProvider);
    const deadline = Date.now() + 1500;
    while (mail.records.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(mail.records).toHaveLength(1);
    expect(mail.records[0].body).toBe("Hello Bob");
  });

  it("delivers an awaited sms message end to end", async ({ expect }) => {
    const { alepha, templates } = await boot();

    await templates.asyncSms.push({
      contact: "+33600000001",
      variables: { name: "Bob" },
    });

    const sms = alepha.inject(MemorySmsProvider);
    const deadline = Date.now() + 1500;
    while (sms.records.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(sms.records).toHaveLength(1);
    expect(sms.records[0].message).toBe("Hi Bob");
  });

  it("still renders a synchronous function body", async ({ expect }) => {
    const { alepha } = await boot();
    const sender = alepha.inject(NotificationSenderService);

    const rendered = await sender.renderEmail({
      type: "email",
      template: "sync-fn-email",
      contact: "carol@example.com",
      variables: { name: "Carol" },
    });

    expect(rendered.body).toBe("Hello Carol");
  });

  it("still renders a plain string body", async ({ expect }) => {
    const { alepha } = await boot();
    const sender = alepha.inject(NotificationSenderService);

    const rendered = await sender.renderEmail({
      type: "email",
      template: "string-email",
      contact: "dave@example.com",
      variables: { name: "Dave" },
    });

    expect(rendered.body).toBe("<p>Static</p>");
  });

  it("still renders a synchronous sms message", async ({ expect }) => {
    const { alepha } = await boot();
    const sender = alepha.inject(NotificationSenderService);

    const rendered = await sender.renderSms({
      type: "sms",
      template: "sync-fn-sms",
      contact: "+33600000002",
      variables: { name: "Erin" },
    });

    expect(rendered.message).toBe("Hi Erin");
  });
});
