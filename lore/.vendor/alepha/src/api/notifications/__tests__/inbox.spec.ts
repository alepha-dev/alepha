import { Alepha, z } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaEmail } from "alepha/email";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSms } from "alepha/sms";
import { describe, it } from "vitest";

import {
  $notification,
  AlephaApiNotifications,
  NotificationChannel,
  NotificationDeliveryService,
  NotificationInboxChannel,
  notificationInboxEntity,
  NotificationInboxRecipientProvider,
  NotificationSenderService,
} from "../index.ts";

const KNOWN = "MEMBER@Example.com";
const KNOWN_USER = "3f1d5f4e-1c2b-4a6d-9f10-2b7c8d9e0a11";

/**
 * The app's half of the seam: an address it knows about, and everything
 * else resolving to nobody.
 *
 * The stored address is deliberately mixed-case, which is what proves the
 * channel normalizes before it asks.
 */
class TestRecipients extends NotificationInboxRecipientProvider {
  public readonly asked: string[] = [];

  public override async resolve(contact: string) {
    this.asked.push(contact);
    return contact === KNOWN.trim().toLowerCase()
      ? { userId: KNOWN_USER }
      : null;
  }
}

class Templates {
  readonly mentioned = $notification({
    name: "inbox-mentioned",
    category: "mentions",
    schema: z.object({ quest: z.text(), project: z.text() }),
    inbox: {
      title: (v) => `You are mentioned in ${v.quest}`,
      body: (v) => `Somebody wrote your name on ${v.quest}.`,
      href: (v) => `/quests/${v.quest}`,
      scope: (v) => `project:${v.project}`,
      scopeLabel: () => "Alepha",
    },
  });

  /**
   * The minimum the option block allows: a title and a place to go.
   */
  readonly bare = $notification({
    name: "inbox-bare",
    schema: z.object({}),
    inbox: {
      title: "Something happened",
      href: "/",
    },
  });

  readonly rows = $repository(notificationInboxEntity);
}

const boot = async () => {
  const alepha = Alepha.create()
    .with({
      provide: NotificationInboxRecipientProvider,
      use: TestRecipients,
    })
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
    channel: alepha.inject(NotificationInboxChannel),
    recipients: alepha.inject(TestRecipients),
    sender: alepha.inject(NotificationSenderService),
    deliveries: alepha.inject(NotificationDeliveryService),
  };
};

describe("the inbox channel", () => {
  it("renders a template and writes one row", async ({ expect }) => {
    const { alepha, templates } = await boot();

    await templates.mentioned.push({
      contact: KNOWN,
      lang: "en",
      variables: { quest: "Q402", project: "65" },
      inline: true,
    });

    const rows = await templates.rows.findMany({});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: KNOWN_USER,
      title: "You are mentioned in Q402",
      body: "Somebody wrote your name on Q402.",
      href: "/quests/Q402",
      scope: "project:65",
      scopeLabel: "Alepha",
      template: "inbox-mentioned",
      category: "mentions",
    });
    expect(rows[0].readAt ?? null).toBeNull();

    await alepha.stop();
  });

  it("takes a plain string for every option", async ({ expect }) => {
    const { alepha, templates } = await boot();

    await templates.bare.push({
      contact: KNOWN,
      lang: "en",
      variables: {},
      inline: true,
    });

    const [row] = await templates.rows.findMany({});
    expect(row).toMatchObject({ title: "Something happened", href: "/" });
    expect(row.scope ?? null).toBeNull();
    expect(row.scopeLabel ?? null).toBeNull();

    await alepha.stop();
  });

  /**
   * The receipt's `contact` column is the operator's only handle on a row,
   * and it is shown beside email addresses and `discord:releases`. A raw
   * uuid there would be unreadable, so the user id rides on the channel's
   * own private R instead.
   */
  it("writes the address, not the user id, into the receipt", async ({
    expect,
  }) => {
    const { alepha, deliveries, sender } = await boot();

    await sender.send(
      {
        type: "inbox",
        template: "inbox-mentioned",
        contact: KNOWN,
        category: "mentions",
        variables: { quest: "Q402", project: "65" },
      },
      { executionId: "inbox-exec-1" },
    );

    const [receipt] = await deliveries.list({});
    expect(receipt).toMatchObject({
      status: "sent",
      channel: "inbox",
      contact: KNOWN,
    });
    expect(receipt.contact).not.toBe(KNOWN_USER);

    await alepha.stop();
  });

  /**
   * An address nobody owns is an ordinary outcome, not a failure: the send
   * declines through `unavailable()`, so one `skipped` receipt is written
   * and the job ends `ok` rather than retrying forever.
   */
  it("declines an address that belongs to nobody", async ({ expect }) => {
    const { alepha, deliveries, sender, templates } = await boot();

    const result = await sender.send(
      {
        type: "inbox",
        template: "inbox-mentioned",
        contact: "stranger@example.com",
        category: "mentions",
        variables: { quest: "Q402", project: "65" },
      },
      { executionId: "inbox-exec-2" },
    );

    expect(result).toMatchObject({ skipped: "unavailable" });
    expect(await templates.rows.findMany({})).toHaveLength(0);

    const [receipt] = await deliveries.list({});
    expect(receipt).toMatchObject({
      status: "skipped",
      skipReason: "unavailable",
      contact: "stranger@example.com",
    });
    expect(receipt.error).toBe("unresolved-recipient");

    await alepha.stop();
  });

  /**
   * The contact reaches the provider trimmed and lower-cased, the same way
   * the suppression list normalizes, so an address typed with a capital
   * letter still finds its owner.
   */
  it("normalizes the contact before resolving it", async ({ expect }) => {
    const { alepha, recipients, templates } = await boot();

    await templates.mentioned.push({
      contact: "  MEMBER@Example.com  ",
      lang: "en",
      variables: { quest: "Q1", project: "1" },
      inline: true,
    });

    expect(recipients.asked.every((it) => it === "member@example.com")).toBe(
      true,
    );
    expect(await templates.rows.findMany({})).toHaveLength(1);

    await alepha.stop();
  });

  /**
   * ⚠️ The channel is a singleton, so a resolution cached on it would
   * deliver one person's message into another person's inbox. Two sends
   * interleaved must each ask again.
   */
  it("resolves the recipient twice per message and caches nothing", async ({
    expect,
  }) => {
    const { alepha, recipients, templates } = await boot();

    await templates.mentioned.push({
      contact: KNOWN,
      lang: "en",
      variables: { quest: "Q1", project: "1" },
      inline: true,
    });

    // Once in unavailable(), once in render(). Not one, which would mean a
    // field on the channel is carrying the answer between them.
    expect(recipients.asked).toHaveLength(2);

    await alepha.stop();
  });

  /**
   * `alepha.services()` filters INSTANTIATED services, so a channel that is
   * exported but never listed in `services[]` is invisible to the registry
   * and the boot check refuses every template declaring it. The templates
   * above declaring `inbox` and `boot()` resolving at all is half the proof;
   * this is the other half.
   */
  it("is registered so the boot check accepts an inbox template", async ({
    expect,
  }) => {
    const { alepha, channel } = await boot();

    expect(channel.channel).toBe("inbox");
    expect(channel.addressable).toBe(true);
    expect(
      alepha.services(NotificationChannel).map((it) => it.channel),
    ).toContain("inbox");

    await alepha.stop();
  });
});
