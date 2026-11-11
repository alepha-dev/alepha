import { createHmac, timingSafeEqual } from "node:crypto";

import { $hook, $inject, Alepha, z } from "alepha";
import { jobExecutionEntity } from "alepha/api/jobs";
import {
  $webhook,
  AlephaApiWebhooks,
  HttpWebhookTransport,
  WebhookDeliveryService,
  WebhookEndpointService,
  WebhookJobs,
  WebhookTransport,
  webhookDeliveryEntity,
  webhookEndpointEntity,
} from "alepha/api/webhooks";
import { BackgroundTaskProvider } from "alepha/background";
import { CryptoProvider, SecretProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DatabaseProvider } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $route, AlephaServer, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

interface Received {
  headers: Record<string, string>;
  body: string;
}

/**
 * The receiver: a second container serving a `$route` declared without
 * `schema.body`, so the bytes arrive unread. It records every request and
 * answers what the spec scripted.
 */
const startReceiver = async () => {
  const received: Received[] = [];
  const script: Array<{ status: number; body?: string }> = [];
  class Receiver {
    hooks = $route({
      method: "POST",
      path: "/hooks",
      handler: async (request) => {
        const req =
          (request.raw as any).node?.req ?? (request.raw as any).web?.req;
        let body = "";
        if (req && typeof req[Symbol.asyncIterator] === "function") {
          for await (const chunk of req) body += chunk;
        } else if (req) {
          body = await req.text();
        }
        received.push({ headers: { ...(request.headers as any) }, body });
        const next = script.shift() ?? { status: 200, body: "ok" };
        request.reply.status = next.status;
        return next.body ?? "";
      },
    });
  }
  const alepha = Alepha.create({ env: { SERVER_PORT: 0 } })
    .with(AlephaServer)
    .with(Receiver);
  await alepha.start();
  const url = `${alepha.inject(ServerProvider).hostname}/hooks`;
  return { alepha, url, received, script };
};

/**
 * The Standard Webhooks check, written here with `node:crypto` and no
 * framework code, so a mistake in `WebhookSigner` cannot also hide in it.
 */
const verifyIndependently = (secret: string, received: Received): boolean => {
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const content = `${received.headers["webhook-id"]}.${received.headers["webhook-timestamp"]}.${received.body}`;
  const expected = createHmac("sha256", key).update(content).digest();
  return received.headers["webhook-signature"]
    .split(" ")
    .map((it) => it.split(",")[1])
    .some((candidate) => {
      const actual = Buffer.from(candidate, "base64");
      return (
        actual.length === expected.length && timingSafeEqual(actual, expected)
      );
    });
};

class Events {
  success: any[] = [];
  errors: any[] = [];
  onSuccess = $hook({
    on: "webhooks:delivery:success",
    handler: (event) => {
      this.success.push(event);
    },
  });
  onError = $hook({
    on: "webhooks:delivery:error",
    handler: (event) => {
      this.errors.push(event);
    },
  });
}

class Shop {
  db = $inject(DatabaseProvider);
  background = $inject(BackgroundTaskProvider);
  endpoints = $inject(WebhookEndpointService);
  delivery = $inject(WebhookDeliveryService);
  deliveries = $repository(webhookDeliveryEntity);
  endpointRows = $repository(webhookEndpointEntity);
  executions = $repository(jobExecutionEntity);

  paid = $webhook({
    name: "order.paid",
    description: "An order was paid in full.",
    schema: z.object({ orderId: z.text(), total: z.number() }),
  });
}

const boot = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with({ provide: WebhookTransport, use: HttpWebhookTransport })
    .with(AlephaApiWebhooks)
    .with(Events);
  const shop = alepha.inject(Shop);
  await alepha.start();
  return { alepha, shop, events: alepha.inject(Events) };
};

describe("webhook delivery", () => {
  it("signs with the Standard Webhooks scheme, and the bytes signed are the bytes sent", async ({
    expect,
  }) => {
    const receiver = await startReceiver();
    const { shop, events } = await boot();
    const { secret } = await shop.endpoints.create({ url: receiver.url });
    const { eventId } = await shop.paid.send({ orderId: "o1", total: 10 });

    await waitFor(
      () => receiver.received.length,
      (n) => n === 1,
      { label: "received" },
    );
    const [request] = receiver.received;
    expect(request.headers["webhook-id"]).toBe(eventId);
    expect(request.headers["webhook-timestamp"]).toMatch(/^\d{10}$/);
    expect(request.headers["webhook-signature"]).toMatch(
      /^v1,[A-Za-z0-9+/]+=*$/,
    );
    expect(request.headers["content-type"]).toBe("application/json");
    expect(verifyIndependently(secret, request)).toBe(true);
    expect(JSON.parse(request.body)).toMatchObject({
      id: eventId,
      type: "order.paid",
      data: { orderId: "o1", total: 10 },
    });

    const [row] = await waitFor(
      () => shop.deliveries.findMany(),
      (rows) => rows[0]?.status === "delivered",
      { label: "delivered" },
    );
    expect(row.attempt).toBe(1);
    expect(row.responseStatus).toBe(200);
    expect(row.responseExcerpt).toBe("ok");
    expect(row.deliveredAt).toBeDefined();
    const endpoint = await shop.endpointRows.getById(row.endpointId);
    expect(endpoint.lastSuccessAt).toBeDefined();
    expect(endpoint.failingSince).toBeUndefined();
    expect(events.success).toHaveLength(1);
    expect(events.success[0]).not.toHaveProperty("url");
    await receiver.alepha.stop();
  });

  it("signs twice while a rotated-out secret is still valid", async ({
    expect,
  }) => {
    const receiver = await startReceiver();
    const { alepha, shop } = await boot();
    const { endpoint, secret } = await shop.endpoints.create({
      url: receiver.url,
    });
    const old = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    const encrypted = await alepha
      .inject(CryptoProvider)
      .encrypt(old, alepha.inject(SecretProvider).secretKey);
    await shop.endpointRows.updateById(endpoint.id, {
      previousSecret: encrypted,
      previousSecretExpiresAt: alepha
        .inject(DateTimeProvider)
        .now()
        .add(1, "hour")
        .toISOString(),
    });
    await shop.paid.send({ orderId: "o1", total: 10 });
    await waitFor(
      () => receiver.received.length,
      (n) => n === 1,
    );
    const [request] = receiver.received;
    expect(request.headers["webhook-signature"].split(" ")).toHaveLength(2);
    expect(verifyIndependently(secret, request)).toBe(true);
    expect(verifyIndependently(old, request)).toBe(true);
    await receiver.alepha.stop();
  });

  it("an expired previous secret no longer signs", async ({ expect }) => {
    const receiver = await startReceiver();
    const { alepha, shop } = await boot();
    const { endpoint } = await shop.endpoints.create({ url: receiver.url });
    const encrypted = await alepha
      .inject(CryptoProvider)
      .encrypt(
        "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
        alepha.inject(SecretProvider).secretKey,
      );
    await shop.endpointRows.updateById(endpoint.id, {
      previousSecret: encrypted,
      previousSecretExpiresAt: alepha
        .inject(DateTimeProvider)
        .now()
        .subtract(1, "minute")
        .toISOString(),
    });
    await shop.paid.send({ orderId: "o1", total: 10 });
    await waitFor(
      () => receiver.received.length,
      (n) => n === 1,
    );
    expect(
      receiver.received[0].headers["webhook-signature"].split(" "),
    ).toHaveLength(1);
    await receiver.alepha.stop();
  });

  it("a 500 records the attempt, sets failingSince and leaves the job to retry on its curve", async ({
    expect,
  }) => {
    const receiver = await startReceiver();
    receiver.script.push({ status: 500, body: "down for maintenance" });
    const { alepha, shop, events } = await boot();
    await shop.endpoints.create({ url: receiver.url });
    await shop.paid.send({ orderId: "o1", total: 10 });

    const [row] = await waitFor(
      () => shop.deliveries.findMany(),
      (rows) => rows[0]?.attempt === 1,
      { label: "first attempt recorded" },
    );
    expect(row.status).toBe("pending");
    expect(row.responseStatus).toBe(500);
    expect(row.responseExcerpt).toBe("down for maintenance");
    expect(row.error).toBe("answered 500");
    const endpoint = await shop.endpointRows.getById(row.endpointId);
    expect(endpoint.failingSince).toBeDefined();
    expect(endpoint.status).toBe("active");

    const [execution] = await waitFor(
      () =>
        shop.executions.findMany({
          where: { jobName: { eq: "system.webhooks.deliver" } },
        }),
      (rows) => rows[0]?.status === "scheduled",
      { label: "retry scheduled" },
    );
    expect(execution.maxAttempts).toBe(8);
    // The first wait is full jitter under a 2 minute ceiling.
    const wait =
      new Date(execution.scheduledAt!).getTime() -
      alepha.inject(DateTimeProvider).nowMillis();
    expect(wait).toBeLessThanOrEqual(2 * 60 * 1000 + 1000);

    const declared = alepha.inject(WebhookJobs).deliver.options.retry;
    expect(declared).toEqual({
      retries: 7,
      backoff: { initial: [2, "minutes"], factor: 4, max: [18, "hours"] },
    });

    expect(events.errors).toEqual([
      expect.objectContaining({
        deliveryId: row.id,
        attempt: 1,
        final: false,
        host: new URL(receiver.url).host,
      }),
    ]);
    expect(events.errors[0]).not.toHaveProperty("url");
    await receiver.alepha.stop();
  });

  it("the last attempt marks the delivery failed before the job gives up", async ({
    expect,
  }) => {
    const receiver = await startReceiver();
    receiver.script.push({ status: 503 });
    const { alepha, shop, events } = await boot();
    const { endpoint } = await shop.endpoints.create({ url: receiver.url });
    // Paused before its job runs, so the job does not race the direct call
    // below: it finds the endpoint paused and leaves the row pending.
    await shop.db.transactional(async () => {
      await shop.paid.send({ orderId: "o1", total: 10 });
      await shop.endpointRows.updateById(endpoint.id, { status: "paused" });
    });
    await shop.background.flush();
    const [row] = await shop.deliveries.findMany();
    expect(row.attempt).toBe(0);
    await shop.endpointRows.updateById(endpoint.id, { status: "active" });
    await expect(
      alepha
        .inject(WebhookDeliveryService)
        .deliver(row.id, { attempt: 8, final: true }),
    ).rejects.toThrow("answered 503");
    const after = await shop.deliveries.getById(row.id);
    expect(after.status).toBe("failed");
    expect(events.errors.at(-1)).toMatchObject({ final: true });
    await receiver.alepha.stop();
  });

  it("a 3xx is a failed attempt and is never followed", async ({ expect }) => {
    const receiver = await startReceiver();
    const target = await startReceiver();
    receiver.script.push({ status: 302 });
    const { shop } = await boot();
    await shop.endpoints.create({ url: receiver.url });
    await shop.paid.send({ orderId: "o1", total: 10 });
    const [row] = await waitFor(
      () => shop.deliveries.findMany(),
      (rows) => rows[0]?.attempt === 1,
    );
    expect(row.responseStatus).toBe(302);
    expect(row.status).toBe("pending");
    expect(target.received).toEqual([]);
    await receiver.alepha.stop();
    await target.alepha.stop();
  });

  it("410 fails the delivery and disables the endpoint at once", async ({
    expect,
  }) => {
    const receiver = await startReceiver();
    receiver.script.push({ status: 410 });
    const { shop } = await boot();
    const { endpoint } = await shop.endpoints.create({ url: receiver.url });
    await shop.paid.send({ orderId: "o1", total: 10 });
    const [row] = await waitFor(
      () => shop.deliveries.findMany(),
      (rows) => rows[0]?.status === "failed",
    );
    expect(row.responseStatus).toBe(410);
    const after = await shop.endpointRows.getById(endpoint.id);
    expect(after.status).toBe("disabled");
    expect(after.disabledReason).toBe("gone");
    await sleep(100);
    expect(receiver.received).toHaveLength(1);
    await receiver.alepha.stop();
  });

  it("a disabled endpoint fails the delivery with no request, a paused one leaves it pending, and resume re-pushes it", async ({
    expect,
  }) => {
    const receiver = await startReceiver();
    const { shop } = await boot();
    const disabled = await shop.endpoints.create({ url: receiver.url });
    const paused = await shop.endpoints.create({ url: receiver.url });
    // Both receive the event while active and change state before its job
    // runs: the job is dispatched after the commit.
    await shop.db.transactional(async () => {
      await shop.paid.send({ orderId: "o1", total: 10 });
      await shop.endpointRows.updateById(disabled.endpoint.id, {
        status: "disabled",
        disabledReason: "failing",
      });
      await shop.endpointRows.updateById(paused.endpoint.id, {
        status: "paused",
      });
    });
    const rows = await waitFor(
      () => shop.deliveries.findMany(),
      (all) =>
        all.find((it) => it.endpointId === disabled.endpoint.id)?.status ===
        "failed",
      { label: "disabled delivery failed" },
    );
    const disabledRow = rows.find(
      (it) => it.endpointId === disabled.endpoint.id,
    )!;
    expect(disabledRow.error).toBe("endpoint disabled");
    expect(disabledRow.attempt).toBe(0);
    const pausedRow = rows.find((it) => it.endpointId === paused.endpoint.id)!;
    expect(pausedRow.status).toBe("pending");
    expect(receiver.received).toEqual([]);

    await shop.endpoints.resume(paused.endpoint.id);
    await waitFor(
      () => receiver.received.length,
      (n) => n === 1,
      { label: "resumed delivery received" },
    );
    await waitFor(
      () => shop.deliveries.getById(pausedRow.id),
      (row) => row.status === "delivered",
    );
    await receiver.alepha.stop();
  });

  it("a secret that does not decrypt fails without retry and disables the endpoint with reason secret", async ({
    expect,
  }) => {
    const receiver = await startReceiver();
    const { alepha, shop, events } = await boot();
    const { endpoint } = await shop.endpoints.create({ url: receiver.url });
    await shop.endpointRows.updateById(endpoint.id, {
      status: "paused",
      secret: await alepha
        .inject(CryptoProvider)
        .encrypt("whsec_AAAA", "a-different-app-secret-entirely"),
    });
    await shop.endpointRows.updateById(endpoint.id, { status: "active" });
    await shop.paid.send({ orderId: "o1", total: 10 });
    const [row] = await waitFor(
      () => shop.deliveries.findMany(),
      (rows) => rows[0]?.status === "failed",
    );
    expect(row.error).toBe("secret unreadable");
    const after = await shop.endpointRows.getById(endpoint.id);
    expect(after.status).toBe("disabled");
    expect(after.disabledReason).toBe("secret");
    expect(receiver.received).toEqual([]);
    expect(events.errors.at(-1)).toMatchObject({ final: true });
    await receiver.alepha.stop();
  });

  describe("the outbox, end to end", () => {
    it("a send inside a committed transaction is received at once, with no sweep", async ({
      expect,
    }) => {
      const receiver = await startReceiver();
      const { shop } = await boot();
      await shop.endpoints.create({ url: receiver.url });
      await shop.db.transactional(async () => {
        await shop.paid.send({ orderId: "o1", total: 10 });
        await sleep(100);
        // Not yet: the delivery waits for the commit.
        expect(receiver.received).toEqual([]);
      });
      await waitFor(
        () => receiver.received.length,
        (n) => n === 1,
        { timeout: 2000, label: "received after commit" },
      );
      await receiver.alepha.stop();
    });

    it("a send inside a rolled-back transaction is never received and leaves no row", async ({
      expect,
    }) => {
      const receiver = await startReceiver();
      const { shop } = await boot();
      await shop.endpoints.create({ url: receiver.url });
      await expect(
        shop.db.transactional(async () => {
          await shop.paid.send({ orderId: "o1", total: 10 });
          throw new Error("roll back");
        }),
      ).rejects.toThrow("roll back");
      await sleep(300);
      expect(receiver.received).toEqual([]);
      expect(await shop.deliveries.findMany()).toEqual([]);
      await receiver.alepha.stop();
    });
  });
});
