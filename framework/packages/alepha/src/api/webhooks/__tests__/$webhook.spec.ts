import { $inject, Alepha, z } from "alepha";
import { jobExecutionEntity } from "alepha/api/jobs";
import {
  $webhook,
  AlephaApiWebhooks,
  WebhookDeliveryService,
  WebhookEndpointService,
  webhookDeliveryEntity,
  webhookEndpointEntity,
} from "alepha/api/webhooks";
import { CryptoProvider, SecretProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DatabaseProvider } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
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

/**
 * Records every delivery the job hands it, and whether the job's execution
 * row was visible then. Nothing is sent: the transport is the next quest.
 */
class RecordingDeliveryService extends WebhookDeliveryService {
  public calls: Array<{ deliveryId: string; executionRows: number }> = [];
  protected readonly executions = $repository(jobExecutionEntity);

  public override async deliver(deliveryId: string): Promise<void> {
    const executionRows = await this.executions.count({
      jobName: { eq: "system.webhooks.deliver" },
    });
    this.calls.push({ deliveryId, executionRows });
  }
}

const dialects = {
  postgres: () => Alepha.create().with(AlephaOrmPostgres),
  sqlite: () => Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
};

class OrderWebhooks {
  db = $inject(DatabaseProvider);
  endpoints = $inject(WebhookEndpointService);
  deliveryRows = $repository(webhookDeliveryEntity);
  endpointRows = $repository(webhookEndpointEntity);
  executions = $repository(jobExecutionEntity);

  paid = $webhook({
    name: "order.paid",
    description: "An order was paid in full.",
    schema: z.object({ orderId: z.text(), total: z.number() }),
  });

  shipped = $webhook({
    name: "order.shipped",
    description: "An order left the warehouse.",
    schema: z.object({ orderId: z.text() }),
  });
}

const boot = async (dialect: keyof typeof dialects) => {
  const alepha = dialects[dialect]()
    .with({ provide: WebhookDeliveryService, use: RecordingDeliveryService })
    .with(AlephaApiWebhooks);
  const app = alepha.inject(OrderWebhooks);
  await alepha.start();
  const recorder = alepha.inject(
    WebhookDeliveryService,
  ) as RecordingDeliveryService;
  return { alepha, app, recorder };
};

describe("$webhook", () => {
  it("refuses a malformed name at registration", async ({ expect }) => {
    class Bad {
      hook = $webhook({
        name: "Order_Paid",
        description: "Badly named.",
        schema: z.object({}),
      });
    }
    const boot = async () =>
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } })
        .with(AlephaApiWebhooks)
        .with(Bad)
        .start();
    await expect(boot()).rejects.toThrow("does not follow");
  });

  it("refuses a duplicate name", async ({ expect }) => {
    class A {
      hook = $webhook({
        name: "order.paid",
        description: "One.",
        schema: z.object({}),
      });
    }
    class B {
      hook = $webhook({
        name: "order.paid",
        description: "Two.",
        schema: z.object({}),
      });
    }
    const boot = async () =>
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } })
        .with(AlephaApiWebhooks)
        .with(A)
        .with(B)
        .start();
    await expect(boot()).rejects.toThrow(
      "Webhook already registered: order.paid",
    );
  });

  for (const dialect of ["postgres", "sqlite"] as const) {
    describe(`on ${dialect}`, () => {
      it("validates the data and writes nothing when it is invalid", async ({
        expect,
      }) => {
        const { app } = await boot(dialect);
        await app.endpoints.create({ url: "https://example.app/hooks" });
        await expect(
          app.paid.send({ orderId: "o1", total: "ten" } as any),
        ).rejects.toThrow();
        expect(await app.deliveryRows.findMany()).toEqual([]);
      });

      it("builds the envelope with a UUIDv7 id and the injected time", async ({
        expect,
      }) => {
        const { alepha, app } = await boot(dialect);
        const now = alepha.inject(DateTimeProvider).pause();
        const { endpoint } = await app.endpoints.create({
          url: "https://example.app/hooks",
        });
        const result = await app.paid.send({ orderId: "o1", total: 10 });
        expect(result.deliveries).toBe(1);
        expect(result.eventId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        const [row] = await app.deliveryRows.findMany();
        expect(row.endpointId).toBe(endpoint.id);
        expect(row.status).toBe("pending");
        expect(row.eventType).toBe("order.paid");
        expect(row.eventId).toBe(result.eventId);
        expect(row.payload).toEqual({
          id: result.eventId,
          type: "order.paid",
          timestamp: now.toISOString(),
          data: { orderId: "o1", total: 10 },
        });
      });

      it("writes one delivery and pushes one keyed job per subscribed active endpoint", async ({
        expect,
      }) => {
        const { app, recorder } = await boot(dialect);
        const all = await app.endpoints.create({
          url: "https://all.example.app/hooks",
        });
        const paidOnly = await app.endpoints.create({
          url: "https://paid.example.app/hooks",
          events: ["order.paid"],
        });
        await app.endpoints.create({
          url: "https://shipped.example.app/hooks",
          events: ["order.shipped"],
        });
        const paused = await app.endpoints.create({
          url: "https://paused.example.app/hooks",
        });
        await app.endpointRows.updateById(paused.endpoint.id, {
          status: "paused",
        });

        const result = await app.paid.send({ orderId: "o1", total: 10 });
        expect(result.deliveries).toBe(2);
        const rows = await app.deliveryRows.findMany();
        expect(rows.map((it) => it.endpointId).sort()).toEqual(
          [all.endpoint.id, paidOnly.endpoint.id].sort(),
        );
        await waitFor(
          () => recorder.calls.length,
          (n) => n === 2,
          { label: "two jobs ran" },
        );
        expect(recorder.calls.map((it) => it.deliveryId).sort()).toEqual(
          rows.map((it) => it.id).sort(),
        );
      });

      it("is fail-closed on scope", async ({ expect }) => {
        const { app } = await boot(dialect);
        const operator = await app.endpoints.create({
          url: "https://ops.example.app/hooks",
        });
        const acme = await app.endpoints.create({
          url: "https://acme.example.app/hooks",
          scope: "acme",
        });
        const globex = await app.endpoints.create({
          url: "https://globex.example.app/hooks",
          scope: "globex",
        });

        const targets = async (scope?: string) => {
          await app.deliveryRows.deleteMany({});
          await app.paid.send({ orderId: "o1", total: 1 }, { scope });
          return (await app.deliveryRows.findMany())
            .map((it) => it.endpointId)
            .sort();
        };

        expect(await targets()).toEqual([operator.endpoint.id]);
        expect(await targets("acme")).toEqual(
          [operator.endpoint.id, acme.endpoint.id].sort(),
        );
        expect(await targets("globex")).toEqual(
          [operator.endpoint.id, globex.endpoint.id].sort(),
        );
      });

      it("writes nothing when no endpoint listens", async ({ expect }) => {
        const { app } = await boot(dialect);
        await app.endpoints.create({
          url: "https://shipped.example.app/hooks",
          events: ["order.shipped"],
        });
        const result = await app.paid.send({ orderId: "o1", total: 10 });
        expect(result.deliveries).toBe(0);
        expect(await app.deliveryRows.findMany()).toEqual([]);
      });

      it("generates a whsec_ secret, stores it encrypted and never returns it on a read", async ({
        expect,
      }) => {
        const { alepha, app } = await boot(dialect);
        const { endpoint, secret } = await app.endpoints.create({
          url: "https://example.app/hooks",
          createdBy: "0192e4c4-0000-7000-8000-000000000001",
        });
        expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
        expect(atob(secret.slice(6))).toHaveLength(32);
        expect(endpoint).not.toHaveProperty("secret");
        expect(endpoint).not.toHaveProperty("previousSecret");
        expect(endpoint.secretPrefix).toBe(secret.slice(0, 10));
        expect(endpoint.createdBy).toBe("0192e4c4-0000-7000-8000-000000000001");

        const row = await app.endpointRows.getById(endpoint.id);
        expect(row.secret).not.toContain(secret.slice(6));
        expect(
          await alepha
            .inject(CryptoProvider)
            .decrypt(row.secret, alepha.inject(SecretProvider).secretKey),
        ).toBe(secret);
        expect(app.endpoints.toResource(row)).not.toHaveProperty("secret");
      });
    });
  }

  describe("inside a transaction (postgres)", () => {
    it("a rollback leaves no delivery row and no job", async ({ expect }) => {
      const { app, recorder } = await boot("postgres");
      await app.endpoints.create({ url: "https://example.app/hooks" });
      await expect(
        app.db.transactional(async () => {
          await app.paid.send({ orderId: "o1", total: 10 });
          await sleep(100);
          throw new Error("roll back");
        }),
      ).rejects.toThrow("roll back");
      await sleep(200);
      expect(recorder.calls).toEqual([]);
      expect(await app.deliveryRows.findMany()).toEqual([]);
      const executions = await app.executions.findMany({
        where: { jobName: { eq: "system.webhooks.deliver" } },
      });
      expect(executions).toEqual([]);
    });

    it("a commit leaves both, and the job runs after it", async ({
      expect,
    }) => {
      const { app, recorder } = await boot("postgres");
      await app.endpoints.create({ url: "https://example.app/hooks" });
      let committed = false;
      const seen: boolean[] = [];
      const original = recorder.deliver.bind(recorder);
      recorder.deliver = async (deliveryId: string) => {
        seen.push(committed);
        await original(deliveryId);
      };
      await app.db.transactional(async () => {
        await app.paid.send({ orderId: "o1", total: 10 });
        await sleep(100);
        committed = true;
      });
      await waitFor(
        () => recorder.calls.length,
        (n) => n === 1,
        { label: "the job ran" },
      );
      expect(seen).toEqual([true]);
      expect(recorder.calls[0].executionRows).toBe(1);
      expect(await app.deliveryRows.findMany()).toHaveLength(1);
    });
  });
});
