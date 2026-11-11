import { randomUUID } from "node:crypto";

import { $hook, $inject, Alepha, z } from "alepha";
import { jobExecutionEntity } from "alepha/api/jobs";
import {
  AlephaApiNotifications,
  NotificationJobs,
} from "alepha/api/notifications";
import {
  $webhook,
  AlephaApiWebhooks,
  MemoryWebhookTransport,
  WebhookDeliveryService,
  WebhookEndpointService,
  WebhookHealthService,
  WebhookNotifications,
  webhookDeliveryEntity,
  webhookEndpointEntity,
} from "alepha/api/webhooks";
import { BackgroundTaskProvider } from "alepha/background";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, DatabaseProvider } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { users } from "../../users/entities/users.ts";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Poll `fn` until `predicate` holds, or throw on timeout.
 */
async function waitFor<T>(
  fn: () => Promise<T> | T,
  predicate: (v: T) => boolean,
  { timeout = 3000, interval = 10, label = "condition" } = {},
): Promise<T> {
  const deadline = Date.now() + timeout;
  let last: T = await fn();
  while (Date.now() < deadline) {
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, interval));
    last = await fn();
  }
  if (predicate(last)) return last;
  throw new Error(
    `waitFor: ${label} not met within ${timeout}ms; last value: ${JSON.stringify(last)}`,
  );
}

class Disabled {
  events: any[] = [];
  onDisabled = $hook({
    on: "webhooks:endpoint:disabled",
    handler: (event) => {
      this.events.push(event);
    },
  });
}

class Shop {
  db = $inject(DatabaseProvider);
  endpoints = $inject(WebhookEndpointService);
  delivery = $inject(WebhookDeliveryService);
  health = $inject(WebhookHealthService);
  deliveries = $repository(webhookDeliveryEntity);
  endpointRows = $repository(webhookEndpointEntity);
  executions = $repository(jobExecutionEntity);
  users = $repository(users);
  paid = $webhook({
    name: "order.paid",
    description: "An order was paid in full.",
    schema: z.object({ orderId: z.text() }),
  });
}

const boot = async (options: { notifications?: boolean } = {}) => {
  const alepha = Alepha.create().with(AlephaOrmPostgres).with(Disabled);
  if (options.notifications) {
    alepha.with(AlephaEmail).with(AlephaApiNotifications);
    alepha.with(WebhookNotifications);
  }
  alepha.with(AlephaApiWebhooks);
  const shop = alepha.inject(Shop);
  await alepha.start();
  const time = alepha.inject(DateTimeProvider);
  time.pause();
  return {
    alepha,
    shop,
    time,
    transport: alepha.inject(MemoryWebhookTransport),
    disabled: alepha.inject(Disabled),
    background: alepha.inject(BackgroundTaskProvider),
  };
};

/**
 * One delivery whose job found the endpoint paused, so the spec drives its
 * attempts by hand; the endpoint is active again when this returns.
 */
const pendingDelivery = async (
  shop: Shop,
  url: string,
  extra: { createdBy?: string } = {},
) => {
  const { endpoint } = await shop.endpoints.create({ url, ...extra });
  await shop.db.transactional(async () => {
    await shop.paid.send({ orderId: randomUUID() });
    await shop.endpointRows.updateById(endpoint.id, { status: "paused" });
  });
  await new Promise((r) => setTimeout(r, 50));
  await shop.endpointRows.updateById(endpoint.id, { status: "active" });
  const rows = await shop.deliveries.findMany({
    where: { endpointId: { eq: endpoint.id } },
  });
  return { endpoint, delivery: rows[0] };
};

describe("webhook endpoint health", () => {
  it("a failed attempt on an endpoint failing for five days disables it with reason failing, without a retry", async ({
    expect,
  }) => {
    const { shop, time, transport, disabled } = await boot();
    const url = "https://down.example.app/hooks";
    transport.respond(url, { status: 503 });
    const { endpoint, delivery } = await pendingDelivery(shop, url);
    await shop.endpointRows.updateById(endpoint.id, {
      failingSince: new Date(time.nowMillis() - 5 * DAY).toISOString(),
    });

    await expect(
      shop.delivery.deliver(delivery.id, { attempt: 1, final: false }),
    ).resolves.toBeUndefined();

    const after = await shop.endpointRows.getById(endpoint.id);
    expect(after.status).toBe("disabled");
    expect(after.disabledReason).toBe("failing");
    expect((await shop.deliveries.getById(delivery.id)).status).toBe("failed");
    expect(disabled.events).toEqual([
      {
        endpointId: endpoint.id,
        host: "down.example.app",
        reason: "failing",
        scope: undefined,
      },
    ]);
  });

  it("one bad day on an endpoint with weekly traffic does not disable it", async ({
    expect,
  }) => {
    const { shop, time, transport, background } = await boot();
    const url = "https://weekly.example.app/hooks";
    transport.respondOnce(url, { status: 500 });
    const { endpoint, delivery } = await pendingDelivery(shop, url);
    await expect(
      shop.delivery.deliver(delivery.id, { attempt: 1, final: false }),
    ).rejects.toThrow("answered 500");
    expect(
      (await shop.endpointRows.getById(endpoint.id)).failingSince,
    ).toBeDefined();

    await background.flush();
    await time.travel(7, "days");
    // travel() fired the hourly purge: let it finish before the next event,
    // whose row the database stamps with its own clock.
    await background.flush();
    await new Promise((r) => setTimeout(r, 100));
    await shop.paid.send({ orderId: "next-week" });
    // Its own job delivers it, against a receiver that recovered.
    await waitFor(
      () => shop.endpointRows.getById(endpoint.id),
      (row) => row.lastSuccessAt !== undefined,
      { label: "next week's event delivered" },
    );
    const after = await shop.endpointRows.getById(endpoint.id);
    expect(after.status).toBe("active");
    expect(after.failingSince).toBeUndefined();
  });

  it("webhooks:endpoint:disabled fires for gone and secret too", async ({
    expect,
  }) => {
    const { alepha, shop, transport, disabled } = await boot();
    const gone = "https://gone.example.app/hooks";
    transport.respond(gone, { status: 410 });
    const first = await pendingDelivery(shop, gone);
    await shop.delivery.deliver(first.delivery.id, {
      attempt: 1,
      final: false,
    });

    const lost = "https://lost.example.app/hooks";
    const second = await pendingDelivery(shop, lost);
    await shop.endpointRows.updateById(second.endpoint.id, {
      secret: await alepha
        .inject(CryptoProvider)
        .encrypt("whsec_AAAA", "another-app-secret"),
    });
    await shop.delivery.deliver(second.delivery.id, {
      attempt: 1,
      final: false,
    });

    expect(disabled.events.map((it) => [it.host, it.reason])).toEqual([
      ["gone.example.app", "gone"],
      ["lost.example.app", "secret"],
    ]);
    for (const event of disabled.events) {
      expect(event).not.toHaveProperty("url");
    }
  });

  it("the notice reaches the creator's email when WebhookNotifications is registered", async ({
    expect,
  }) => {
    const { alepha, shop, transport, background } = await boot({
      notifications: true,
    });
    const owner = await shop.users.create({
      id: randomUUID(),
      email: `ops-${randomUUID().slice(0, 8)}@example.com`,
      username: `ops-${randomUUID().slice(0, 8)}`,
    });
    const url = "https://gone.example.app/hooks";
    transport.respond(url, { status: 410 });
    const { delivery } = await pendingDelivery(shop, url, {
      createdBy: owner.id,
    });
    await shop.delivery.deliver(delivery.id, { attempt: 1, final: false });
    await background.flush();

    const jobName = alepha.inject(NotificationJobs).sendNotification.name;
    const notices = await shop.executions.findMany({
      where: { jobName: { eq: jobName } },
    });
    const payloads = notices.map(
      (it) =>
        it.payload as { contact?: string; variables?: { reason?: string } },
    );
    expect(
      payloads.some(
        (it) => it.contact === owner.email && it.variables?.reason === "gone",
      ),
    ).toBe(true);
  });

  it("without WebhookNotifications the disable still happens and nothing is sent", async ({
    expect,
  }) => {
    const { alepha, shop, transport } = await boot();
    expect(alepha.has(WebhookNotifications)).toBe(false);
    const url = "https://gone.example.app/hooks";
    transport.respond(url, { status: 410 });
    const { endpoint, delivery } = await pendingDelivery(shop, url, {
      createdBy: randomUUID(),
    });
    await shop.delivery.deliver(delivery.id, { attempt: 1, final: false });
    expect((await shop.endpointRows.getById(endpoint.id)).status).toBe(
      "disabled",
    );
  });

  describe("system.webhooks.purge-old", () => {
    it("deletes deliveries past 30 days, clears expired previous secrets, and fails stuck deliveries except on a paused endpoint", async ({
      expect,
    }) => {
      const { shop, time, background } = await boot();
      const old = await pendingDelivery(shop, "https://old.example.app/hooks");
      await shop.delivery.deliver(old.delivery.id, {
        attempt: 1,
        final: false,
      });
      const stuck = await pendingDelivery(
        shop,
        "https://stuck.example.app/hooks",
      );
      const held = await pendingDelivery(
        shop,
        "https://held.example.app/hooks",
      );
      await shop.endpointRows.updateById(held.endpoint.id, {
        status: "paused",
      });
      await shop.endpointRows.updateById(old.endpoint.id, {
        previousSecret: "an-old-encrypted-secret",
        previousSecretExpiresAt: new Date(time.nowMillis() + DAY).toISOString(),
      });

      // Three days on: the stuck one is past 72 hours, the secret expired,
      // nothing is past 30 days yet. travel() fires the hourly purge itself.
      await background.flush();
      await time.travel(73, "hours");
      await shop.health.purge();
      expect((await shop.deliveries.getById(stuck.delivery.id)).status).toBe(
        "failed",
      );
      expect((await shop.deliveries.getById(stuck.delivery.id)).error).toBe(
        "no outcome recorded",
      );
      expect((await shop.deliveries.getById(held.delivery.id)).status).toBe(
        "pending",
      );
      const endpoint = await shop.endpointRows.getById(old.endpoint.id);
      expect(endpoint.previousSecret).toBeUndefined();
      expect(endpoint.previousSecretExpiresAt).toBeUndefined();
      expect(await shop.deliveries.findById(old.delivery.id)).toBeDefined();

      await background.flush();
      await time.travel(28, "days");
      await shop.health.purge();
      expect(await shop.deliveries.findById(old.delivery.id)).toBeUndefined();
      expect(await shop.deliveries.findMany()).toEqual([]);
    });
  });
});
