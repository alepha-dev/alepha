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
  NotificationEmailChannel,
  type NotificationPayload,
  type NotificationRendered,
  type NotificationRenderInput,
  NotificationSenderService,
} from "../index.ts";

declare module "alepha/api/notifications" {
  interface NotificationChannels<V> {
    /**
     * A channel these specs register, which refuses some contacts before
     * anything is rendered.
     */
    courier?: { message: (variables: V) => string | Promise<string> };
  }
}

type CourierMessage = { message: (variables: any) => string | Promise<string> };

/**
 * A channel that cannot deliver to everybody it is handed.
 *
 * The point of the specs below is that it says so through `unavailable()`
 * rather than by throwing from `render()`, which is the only thing it could
 * have done before this seam existed.
 */
class CourierChannel extends NotificationChannel<CourierMessage> {
  public readonly channel = "courier";
  public readonly addressable = true;

  public readonly sent: NotificationRendered[] = [];
  public rendered = 0;

  public async unavailable(payload: NotificationPayload) {
    const contact = payload.contact ?? "";
    if (contact.endsWith("@nowhere.test")) {
      return { reason: "no-route", recipient: contact };
    }
    return undefined;
  }

  public async render(input: NotificationRenderInput<CourierMessage>) {
    this.rendered++;
    return {
      recipient: input.payload.contact!,
      body: await input.message.message(input.variables),
    };
  }

  public async send(rendered: NotificationRendered) {
    this.sent.push(rendered);
    return { messageId: "courier-1" };
  }
}

class Templates {
  readonly parcel = $notification({
    name: "unavailable-parcel",
    category: "reminders",
    schema: z.object({ tag: z.text() }),
    courier: { message: (v) => `parcel ${v.tag}` },
  });
}

const boot = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaEmail)
    .with(AlephaSms)
    .with(AlephaApiJobs)
    .with(AlephaApiNotifications);

  const courier = alepha.inject(CourierChannel);
  const templates = alepha.inject(Templates);
  await alepha.start();

  return {
    alepha,
    courier,
    templates,
    sender: alepha.inject(NotificationSenderService),
    deliveries: alepha.inject(NotificationDeliveryService),
  };
};

const payload = (contact: string) => ({
  type: "courier" as const,
  template: "unavailable-parcel",
  contact,
  variables: { tag: "v1" },
  category: "reminders",
});

describe("a channel that cannot deliver", () => {
  /**
   * The whole reason the seam exists. Throwing from `render()` writes no
   * receipt (it is called outside `attempt()`) and the job retries a contact
   * that will never resolve, burning every attempt down to a terminal
   * failure.
   */
  it("writes one skipped receipt and returns rather than throwing", async ({
    expect,
  }) => {
    const { alepha, courier, deliveries, sender } = await boot();

    const result = await sender.send(payload("ghost@nowhere.test"), {
      executionId: "unavailable-exec-1",
    });

    expect(result).toMatchObject({
      type: "courier",
      to: "ghost@nowhere.test",
      skipped: "unavailable",
    });

    const receipts = await deliveries.list({});
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      executionId: "unavailable-exec-1",
      status: "skipped",
      skipReason: "unavailable",
      channel: "courier",
      contact: "ghost@nowhere.test",
    });
    expect(receipts[0].error).toBe("no-route");

    // Nothing was rendered and nothing was sent: the refusal comes first.
    expect(courier.rendered).toBe(0);
    expect(courier.sent).toHaveLength(0);

    await alepha.stop();
  });

  /**
   * A `skipped` send is not a failure, so the job row ends `ok` and there is
   * no attempt two. Re-running the same execution is what a retry would look
   * like, and it must never accumulate receipts.
   */
  it("settles one receipt even if the same execution runs again", async ({
    expect,
  }) => {
    const { alepha, deliveries, sender } = await boot();

    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(
        sender.send(payload("ghost@nowhere.test"), {
          executionId: "unavailable-exec-2",
        }),
      ).resolves.toMatchObject({ skipped: "unavailable" });
    }

    expect(await deliveries.list({})).toHaveLength(1);

    await alepha.stop();
  });

  it("delivers normally to a contact the channel accepts", async ({
    expect,
  }) => {
    const { alepha, courier, deliveries, sender } = await boot();

    await sender.send(payload("real@example.com"), {
      executionId: "unavailable-exec-3",
    });

    expect(courier.rendered).toBe(1);
    expect(courier.sent).toHaveLength(1);

    const [receipt] = await deliveries.list({});
    expect(receipt).toMatchObject({ status: "sent", channel: "courier" });
    expect(receipt.skipReason ?? null).toBeNull();

    await alepha.stop();
  });

  /**
   * The default is undefined, so every channel written before this seam
   * existed, and every plugin channel outside this repository, keeps
   * sending without knowing the method is there.
   */
  it("defaults to undefined for a channel that does not override it", async ({
    expect,
  }) => {
    const { alepha } = await boot();

    const email = alepha.inject(NotificationEmailChannel);
    expect(
      await email.unavailable({
        type: "email",
        template: "unavailable-parcel",
        contact: "ghost@nowhere.test",
        variables: {},
      }),
    ).toBe(undefined);

    await alepha.stop();
  });
});
