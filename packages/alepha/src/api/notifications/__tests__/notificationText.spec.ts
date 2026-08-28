import { Alepha, z } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSms } from "alepha/sms";
import { describe, it } from "vitest";

import {
  $notification,
  AlephaApiNotifications,
  NotificationSenderService,
} from "../index.ts";

/**
 * `EmailSendOptions.text` exists so a message is not HTML-only, which every
 * spam filter scores down. Filling it per template would mean nothing
 * improves until each of the 46 templates in the ecosystem is rewritten, so
 * the sender derives one when the template did not supply it. A template
 * that wants better text than the derivation still wins.
 */
class Templates {
  readonly derived = $notification({
    name: "derived-text",
    schema: z.object({ name: z.text() }),
    email: {
      subject: "Derived",
      body: (vars) =>
        `<h1>Hello ${vars.name}</h1><p>Visit <a href="https://example.com/go">the page</a>.</p>`,
    },
  });

  readonly declared = $notification({
    name: "declared-text",
    schema: z.object({ name: z.text() }),
    email: {
      subject: "Declared",
      body: (vars) => `<p>Hello ${vars.name}</p>`,
      text: (vars) => `Hello ${vars.name}, in words chosen by hand.`,
    },
  });

  readonly declaredStatic = $notification({
    name: "declared-static-text",
    schema: z.object({}),
    email: {
      subject: "Static",
      body: "<p>Rich</p>",
      text: "Plain",
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

describe("notification email carries a plain-text part", () => {
  it("derives text from the body when the template declares none", async ({
    expect,
  }) => {
    const { alepha } = await boot();
    const sender = alepha.inject(NotificationSenderService);

    const rendered = await sender.renderEmail({
      type: "email",
      template: "derived-text",
      contact: "alice@example.com",
      variables: { name: "Alice" },
    });

    expect(rendered.text).toBe(
      "Hello Alice\n\nVisit the page (https://example.com/go).",
    );
  });

  it("prefers the template's own text over the derivation", async ({
    expect,
  }) => {
    const { alepha } = await boot();
    const sender = alepha.inject(NotificationSenderService);

    const rendered = await sender.renderEmail({
      type: "email",
      template: "declared-text",
      contact: "alice@example.com",
      variables: { name: "Alice" },
    });

    expect(rendered.text).toBe("Hello Alice, in words chosen by hand.");
  });

  it("accepts a static text beside a static body", async ({ expect }) => {
    const { alepha } = await boot();
    const sender = alepha.inject(NotificationSenderService);

    const rendered = await sender.renderEmail({
      type: "email",
      template: "declared-static-text",
      contact: "alice@example.com",
      variables: {},
    });

    expect(rendered.text).toBe("Plain");
  });

  it("delivers the text part to the provider", async ({ expect }) => {
    const { alepha, templates } = await boot();

    await templates.derived.push({
      contact: "bob@example.com",
      variables: { name: "Bob" },
    });

    const mail = alepha.inject(MemoryEmailProvider);
    const deadline = Date.now() + 1500;
    while (mail.records.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(mail.records).toHaveLength(1);
    expect(mail.records[0].text).toBe(
      "Hello Bob\n\nVisit the page (https://example.com/go).",
    );
  });
});
