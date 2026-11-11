import { $inject, Alepha, z } from "alepha";
import {
  $webhook,
  AlephaApiWebhooks,
  MemoryWebhookTransport,
  WebhookDeliveryService,
  WebhookEndpointService,
  WebhookTransport,
  webhookDeliveryEntity,
} from "alepha/api/webhooks";
import { $repository } from "alepha/orm";
import { WebhookVerifier } from "alepha/security";
import { describe, it } from "vitest";

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

class Shop {
  endpoints = $inject(WebhookEndpointService);
  delivery = $inject(WebhookDeliveryService);
  deliveries = $repository(webhookDeliveryEntity);
  verifier = $inject(WebhookVerifier);
  paid = $webhook({
    name: "order.paid",
    description: "An order was paid in full.",
    schema: z.object({ orderId: z.text() }),
  });
  shipped = $webhook({
    name: "order.shipped",
    description: "An order left the warehouse.",
    schema: z.object({ orderId: z.text() }),
  });
}

const boot = async () => {
  const alepha = Alepha.create({
    env: { DATABASE_URL: "sqlite://:memory:" },
  }).with(AlephaApiWebhooks);
  const shop = alepha.inject(Shop);
  await alepha.start();
  return {
    alepha,
    shop,
    transport: alepha.inject(MemoryWebhookTransport),
  };
};

describe("MemoryWebhookTransport", () => {
  it("is the transport under test, and records every send", async ({
    expect,
  }) => {
    const { alepha, shop, transport } = await boot();
    expect(alepha.inject(WebhookTransport)).toBe(transport);
    const a = "https://a.example.app/hooks";
    const b = "https://b.example.app/hooks";
    await shop.endpoints.create({ url: a });
    await shop.endpoints.create({ url: b, events: ["order.shipped"] });
    await shop.paid.send({ orderId: "o1" });
    await shop.shipped.send({ orderId: "o1" });
    await waitFor(
      () => transport.requests.length,
      (n) => n === 3,
    );
    expect(transport.wasDelivered("order.paid")).toBe(true);
    expect(transport.wasDelivered("order.paid", a)).toBe(true);
    expect(transport.wasDelivered("order.paid", b)).toBe(false);
    expect(transport.deliveriesFor(b).map((it) => it.envelope.type)).toEqual([
      "order.shipped",
    ]);
    expect(transport.lastEnvelope("order.shipped")).toMatchObject({
      type: "order.shipped",
      data: { orderId: "o1" },
    });
  });

  it("plays fail twice then 200, and a network failure", async ({ expect }) => {
    const { shop, transport } = await boot();
    const url = "https://flaky.example.app/hooks";
    const down = "https://down.example.app/hooks";
    await shop.endpoints.create({ url });
    transport
      .respondOnce(url, { status: 500 })
      .respondOnce(url, { status: 502 });
    await shop.paid.send({ orderId: "o1" });
    const [row] = await waitFor(
      () => shop.deliveries.findMany(),
      (rows) => rows[0]?.attempt === 1,
    );
    expect(row.responseStatus).toBe(500);
    // The job's retry waits minutes: drive the next attempts by hand.
    await expect(
      shop.delivery.deliver(row.id, { attempt: 2, final: false }),
    ).rejects.toThrow("answered 502");
    await shop.delivery.deliver(row.id, { attempt: 3, final: false });
    const after = await shop.deliveries.getById(row.id);
    expect(after.status).toBe("delivered");
    expect(after.attempt).toBe(3);
    expect(transport.deliveriesFor(url).map((it) => it.outcome)).toEqual([
      500, 502, 200,
    ]);

    transport.failNetwork(down);
    await shop.endpoints.create({ url: down, events: ["order.shipped"] });
    await shop.shipped.send({ orderId: "o2" });
    await waitFor(
      () => transport.deliveriesFor(down).length,
      (n) => n === 1,
    );
    expect(transport.deliveriesFor(down)[0].outcome).toBe("network");
    expect(transport.wasDelivered("order.shipped", down)).toBe(false);
  });

  it("signs for real: the recorded headers pass WebhookVerifier", async ({
    expect,
  }) => {
    const { shop, transport } = await boot();
    const url = "https://a.example.app/hooks";
    const { secret } = await shop.endpoints.create({ url });
    await shop.paid.send({ orderId: "o1" });
    await waitFor(
      () => transport.requests.length,
      (n) => n === 1,
    );
    const [request] = transport.requests;
    await expect(
      shop.verifier.verify({
        headers: request.headers,
        body: request.body,
        secret,
      }),
    ).resolves.toBeUndefined();
  });
});
