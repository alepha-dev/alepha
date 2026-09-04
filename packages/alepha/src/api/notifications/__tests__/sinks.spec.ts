import { Alepha, z } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaEmail } from "alepha/email";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSms } from "alepha/sms";
import { describe, it } from "vitest";

import {
  $notification,
  AlephaApiNotifications,
  NotificationChannel,
  NotificationDeliveryService,
  type NotificationRendered,
  type NotificationRenderInput,
  NotificationSenderService,
  NotificationSuppressionService,
} from "../index.ts";

/**
 * A sink plugin declares BOTH interfaces from one entry point. Without the
 * second, `push()` on a beacon-only template would still demand a contact
 * for a message going to a room.
 */
declare module "alepha/api/notifications" {
  interface NotificationChannels<V> {
    beacon?: {
      to?: string;
      message: (variables: V) => string | Promise<string>;
    };
  }
  interface NotificationSinkChannels {
    beacon: true;
  }
}

type BeaconMessage = {
  to?: string;
  message: (variables: any) => string | Promise<string>;
};

/**
 * A sink: it fires at a named destination, and the destination never leaves
 * the plugin.
 */
class BeaconChannel extends NotificationChannel<BeaconMessage> {
  public readonly channel = "beacon";
  public readonly addressable = false;

  public readonly sent: NotificationRendered[] = [];

  public async render(input: NotificationRenderInput<BeaconMessage>) {
    const to = input.message.to ?? "default";
    return {
      recipient: `beacon:${to}`,
      body: await input.message.message(input.variables),
    };
  }

  public async send(rendered: NotificationRendered) {
    this.sent.push(rendered);
    return { messageId: "beacon-1" };
  }
}

class Templates {
  readonly shipped = $notification({
    name: "sink-shipped",
    category: "releases",
    schema: z.object({ tag: z.text() }),
    beacon: { to: "alerts", message: (v) => `shipped ${v.tag}` },
  });

  readonly both = $notification({
    name: "sink-both",
    category: "releases",
    schema: z.object({ tag: z.text() }),
    email: { subject: "Shipped", body: (v) => `<p>${v.tag}</p>` },
    beacon: { message: (v) => `shipped ${v.tag}` },
  });

  readonly plain = $notification({
    name: "sink-email-only",
    schema: z.object({ tag: z.text() }),
    email: { subject: "Shipped", body: (v) => v.tag },
  });
}

const boot = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaOrmPostgres)
    .with(AlephaEmail)
    .with(AlephaSms)
    .with(AlephaApiJobs)
    .with(AlephaApiNotifications);

  const beacon = alepha.inject(BeaconChannel);
  const templates = alepha.inject(Templates);
  await alepha.start();

  return {
    alepha,
    beacon,
    templates,
    sender: alepha.inject(NotificationSenderService),
    deliveries: alepha.inject(NotificationDeliveryService),
    suppressions: alepha.inject(NotificationSuppressionService),
  };
};

describe("sink channels", () => {
  it("pushes with no contact at all", async ({ expect }) => {
    const { alepha, beacon, templates } = await boot();

    await templates.shipped.push({
      variables: { tag: "v1.2.3" },
      inline: true,
    });

    expect(beacon.sent).toHaveLength(1);
    expect(beacon.sent[0].body).toBe("shipped v1.2.3");
    expect(beacon.sent[0].recipient).toBe("beacon:alerts");

    await alepha.stop();
  });

  /**
   * The receipt's `contact` column is NOT NULL and stays that way. What
   * fills it is whatever the channel says it reached, which is the whole
   * reason `recipient` is on the contract rather than reconstructed by the
   * sender.
   */
  it("writes channel:destination into the receipt's contact", async ({
    expect,
  }) => {
    const { alepha, deliveries, sender } = await boot();

    await sender.send(
      {
        type: "beacon",
        template: "sink-shipped",
        variables: { tag: "v2" },
        category: "releases",
      },
      { executionId: "sink-exec-1" },
    );

    const [receipt] = await deliveries.list({});
    expect(receipt).toMatchObject({
      executionId: "sink-exec-1",
      status: "sent",
      channel: "beacon",
      contact: "beacon:alerts",
      messageId: "beacon-1",
    });

    await alepha.stop();
  });

  /**
   * ⚠️ The gate must not run at all. A suppression row spelled
   * `beacon:alerts` would otherwise be indelible: nobody can click an
   * unsubscribe link for a chatroom, so an ops alert silenced by a stray
   * bounce would stay silenced.
   */
  it("does not run the suppression gate on the destination", async ({
    expect,
  }) => {
    const { alepha, beacon, suppressions, templates } = await boot();

    await suppressions.suppress({
      contact: "beacon:alerts",
      channel: "beacon",
      reason: "bounced",
      source: "admin",
    });

    await templates.shipped.push({
      variables: { tag: "v3" },
      inline: true,
    });

    expect(beacon.sent).toHaveLength(1);

    await alepha.stop();
  });

  /**
   * A template with one addressable channel is addressable: the email half
   * still goes through the gate and still needs somebody to send to.
   */
  it("still gates the addressable half of a mixed template", async ({
    expect,
  }) => {
    const { alepha, beacon, deliveries, suppressions, templates } =
      await boot();

    await suppressions.suppress({
      contact: "a@example.com",
      channel: "email",
      reason: "complained",
      source: "admin",
    });

    await templates.both.push({
      contact: "a@example.com",
      variables: { tag: "v4" },
      inline: true,
    });

    // The sink fired; the email did not.
    expect(beacon.sent).toHaveLength(1);
    const receipts = await deliveries.list({});
    const byChannel = Object.fromEntries(
      receipts.map((it) => [it.channel, it]),
    );
    expect(byChannel.email.status).toBe("skipped");
    expect(byChannel.email.skipReason).toBe("suppressed");
    expect(byChannel.beacon.status).toBe("sent");

    await alepha.stop();
  });

  /**
   * The type-level half, pinned in both directions: the two
   * `@ts-expect-error` assertions fail the BUILD if a future signature
   * change ever loosens `contact`, which a review would not catch.
   *
   * They are also run, because the runtime refusal is worth having on its
   * own: a payload can be built by hand (an admin resend, a row queued by an
   * older version) and reach the sender with no contact at all.
   */
  it("makes contact optional if and only if every channel is a sink", async ({
    expect,
  }) => {
    const { alepha, templates } = await boot();

    // A sink-only template: no contact, and that compiles.
    await templates.shipped.push({ variables: { tag: "v5" }, inline: true });

    await expect(
      // @ts-expect-error a mixed template still requires a contact
      templates.both.push({ variables: { tag: "v6" }, inline: true }),
    ).rejects.toThrowError(/has no contact, which channel "email" needs/);

    await expect(
      // @ts-expect-error an addressable-only template requires a contact
      templates.plain.push({ variables: { tag: "v7" }, inline: true }),
    ).rejects.toThrowError(/has no contact, which channel "email" needs/);

    await alepha.stop();
  });
});
