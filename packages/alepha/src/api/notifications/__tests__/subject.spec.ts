import { Alepha, z } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSms } from "alepha/sms";
import { describe, it } from "vitest";

import {
  $notification,
  AlephaApiNotifications,
  NotificationDeliveryService,
  NotificationSenderService,
} from "../index.ts";

/**
 * A subject may be built from the template's variables, exactly like a body.
 *
 * It could not be, for as long as the primitive existed: `subject` was typed
 * `string` while `body` and `text` beside it took a function of the
 * variables. The subject is the line a phone shows in its notification, so a
 * sign-in code that is not in it is a code somebody has to open a mail client
 * to read - which is why one real message stayed on a bare `$email.send` for
 * a fortnight while every other one moved onto `$notification`.
 *
 * A plain string still takes the branch it always did, so no existing
 * template changes behaviour. The specs below pin both halves.
 */
class Templates {
  readonly code = $notification({
    name: "subject-code",
    schema: z.object({ code: z.text() }),
    email: {
      subject: (vars) => `Your code is ${vars.code}`,
      body: (vars) => `<p>${vars.code}</p>`,
    },
  });

  readonly asyncSubject = $notification({
    name: "subject-async",
    schema: z.object({ amount: z.integer() }),
    email: {
      subject: async (vars) => `Invoice for ${vars.amount} EUR`,
      body: "<p>See attached</p>",
    },
  });

  readonly withUnsubscribe = $notification({
    name: "subject-unsubscribe",
    schema: z.object({ name: z.text() }),
    email: {
      subject: (vars) =>
        `${vars.name}: ${vars.unsubscribeUrl ? "opt-out" : "no opt-out"}`,
      body: "<p>Hello</p>",
    },
  });

  readonly stringSubject = $notification({
    name: "subject-string",
    schema: z.object({ name: z.text() }),
    email: {
      subject: "Static subject",
      body: (vars) => `<p>${vars.name}</p>`,
    },
  });

  /**
   * `sensitive` stores `null` on the receipt instead of the subject. It was
   * already written for a subject carrying a name or an amount, which a
   * static string could not do - so it is only now that it has anything to
   * protect.
   */
  readonly sensitiveSubject = $notification({
    name: "subject-sensitive",
    sensitive: true,
    schema: z.object({ code: z.text() }),
    email: {
      subject: (vars) => `Your code is ${vars.code}`,
      body: "<p>See the subject</p>",
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

describe("a notification subject may be built from the variables", () => {
  it("renders a subject function", async ({ expect }) => {
    const { alepha } = await boot();
    const sender = alepha.inject(NotificationSenderService);

    const rendered = await sender.renderEmail({
      type: "email",
      template: "subject-code",
      contact: "alice@example.com",
      variables: { code: "418294" },
    });

    expect(rendered.subject).toBe("Your code is 418294");
  });

  it("awaits an asynchronous subject", async ({ expect }) => {
    const { alepha } = await boot();
    const sender = alepha.inject(NotificationSenderService);

    const rendered = await sender.renderEmail({
      type: "email",
      template: "subject-async",
      contact: "alice@example.com",
      variables: { amount: 42 },
    });

    expect(rendered.subject).toBe("Invoice for 42 EUR");
  });

  it("sees the same extras the body does, unsubscribeUrl included", async ({
    expect,
  }) => {
    const { alepha } = await boot();
    const sender = alepha.inject(NotificationSenderService);

    // Resolving the subject before `renderVariables` was built would leave
    // the extras out of it, which is the ordering this pins.
    const rendered = await sender.renderEmail({
      type: "email",
      template: "subject-unsubscribe",
      contact: "alice@example.com",
      variables: { name: "Alice" },
      critical: true,
    });

    // Critical: no unsubscribe link exists, and the subject sees that rather
    // than seeing nothing at all.
    expect(rendered.subject).toBe("Alice: no opt-out");
  });

  it("still renders a plain string subject", async ({ expect }) => {
    const { alepha } = await boot();
    const sender = alepha.inject(NotificationSenderService);

    const rendered = await sender.renderEmail({
      type: "email",
      template: "subject-string",
      contact: "bob@example.com",
      variables: { name: "Bob" },
    });

    expect(rendered.subject).toBe("Static subject");
  });

  it("delivers a built subject end to end", async ({ expect }) => {
    const { alepha, templates } = await boot();

    await templates.code.push({
      contact: "carol@example.com",
      variables: { code: "902133" },
    });

    const mail = alepha.inject(MemoryEmailProvider);
    const deadline = Date.now() + 1500;
    while (mail.records.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(mail.records).toHaveLength(1);
    expect(mail.records[0].subject).toBe("Your code is 902133");
  });

  it("keeps a sensitive template's built subject off the receipt", async ({
    expect,
  }) => {
    const { alepha } = await boot();
    const sender = alepha.inject(NotificationSenderService);
    const deliveries = alepha.inject(NotificationDeliveryService);

    await sender.send(
      {
        type: "email",
        template: "subject-sensitive",
        contact: "dave@example.com",
        variables: { code: "551104" },
        // On the payload, not read off the template: `push()` is what copies
        // the template's own flag onto the payload it enqueues.
        sensitive: true,
      },
      { executionId: "exec-subject" },
    );

    // Delivered with the code, so the recipient reads it off their phone...
    const mail = alepha.inject(MemoryEmailProvider);
    expect(mail.last?.subject).toBe("Your code is 551104");

    // ...and absent from the receipt, which is what `sensitive` is for. That
    // branch was written for "a subject can carry a name or an amount" and
    // had nothing to protect until a subject could be built at all.
    const receipts = await deliveries.list({});
    expect(receipts).toHaveLength(1);
    // `?? null` because a null column reads back as undefined, the same way
    // the neighbouring body assertion in `deliveries.spec.ts` writes it.
    expect(receipts[0].subject ?? null).toBeNull();
  });
});
