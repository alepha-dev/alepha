import { $inject, Alepha, z } from "alepha";
import { audits } from "alepha/api/audits";
import {
  $webhook,
  AdminWebhookController,
  AlephaApiWebhooks,
  MemoryWebhookTransport,
  WebhookEndpointNotActiveError,
  webhookDeliveryEntity,
  webhookEndpointEntity,
} from "alepha/api/webhooks";
import { BackgroundTaskProvider } from "alepha/background";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $role, AlephaSecurity, type UserAccountToken } from "alepha/security";
import { ForbiddenError, NotFoundError } from "alepha/server";
import {
  $swagger,
  AlephaServerSwagger,
  ServerSwaggerProvider,
} from "alepha/server/swagger";
import { describe, it } from "vitest";

class Roles {
  reader = $role({
    name: "webhook-reader",
    permissions: [{ name: "admin:webhook:read" }],
  });
  writer = $role({
    name: "webhook-writer",
    permissions: [
      { name: "admin:webhook:read" },
      { name: "admin:webhook:write" },
    ],
  });
}

const user = (role: string): UserAccountToken => ({
  id: "00000000-0000-4000-8000-00000000abcd",
  realm: "default",
  roles: [role],
});

const reader = { user: user("webhook-reader") };
const writer = { user: user("webhook-writer") };

class Shop {
  background = $inject(BackgroundTaskProvider);
  deliveries = $repository(webhookDeliveryEntity);
  endpointRows = $repository(webhookEndpointEntity);
  audits = $repository(audits);
  paid = $webhook({
    name: "order.paid",
    description: "An order was paid in full.",
    schema: z.object({ orderId: z.uuid(), total: z.number() }),
  });
  shipped = $webhook({
    name: "order.shipped",
    description: "An order left the warehouse.",
    schema: z.object({ orderId: z.uuid() }),
  });
  docs = $swagger({ info: { title: "Shop", version: "1.0.0" } });
}

const boot = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaSecurity)
    .with(AlephaServerSwagger)
    .with(AlephaApiWebhooks);
  alepha.inject(Roles);
  const shop = alepha.inject(Shop);
  await alepha.start();
  return {
    alepha,
    shop,
    api: alepha.inject(AdminWebhookController),
    transport: alepha.inject(MemoryWebhookTransport),
  };
};

const ORDER = "0192e4c4-0000-7000-8000-000000000042";

describe("AdminWebhookController", () => {
  it("gates reads on admin:webhook:read and writes on admin:webhook:write", async ({
    expect,
  }) => {
    const { api } = await boot();
    await expect(
      api.createWebhookEndpoint.run(
        { body: { url: "https://example.app/hooks" } },
        reader,
      ),
    ).rejects.toThrow(ForbiddenError);
    const { endpoint } = await api.createWebhookEndpoint.run(
      { body: { url: "https://example.app/hooks" } },
      writer,
    );
    const page = await api.findWebhookEndpoints.run({ query: {} }, reader);
    expect(page.content.map((it) => it.id)).toEqual([endpoint.id]);
    for (const call of [
      () =>
        api.updateWebhookEndpoint.run(
          {
            params: { id: endpoint.id },
            query: {},
            body: { description: "x" },
          },
          reader,
        ),
      () =>
        api.deleteWebhookEndpoint.run(
          { params: { id: endpoint.id }, query: {} },
          reader,
        ),
      () =>
        api.rotateWebhookEndpointSecret.run(
          { params: { id: endpoint.id }, query: {}, body: {} },
          reader,
        ),
      () =>
        api.enableWebhookEndpoint.run(
          { params: { id: endpoint.id }, query: {} },
          reader,
        ),
      () =>
        api.sendTestWebhook.run(
          { params: { id: endpoint.id }, query: {} },
          reader,
        ),
    ]) {
      await expect(call()).rejects.toThrow(ForbiddenError);
    }
    await expect(
      api.findWebhookEndpoints.run({ query: {} }, { user: user("nobody") }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      api.getWebhookEvents.run({}, { user: user("nobody") }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("creates with createdBy and the secret once, and no other response carries a secret", async ({
    expect,
  }) => {
    const { api, shop } = await boot();
    const created = await api.createWebhookEndpoint.run(
      { body: { url: "https://example.app/hooks", events: ["order.paid"] } },
      writer,
    );
    expect(created.secret).toMatch(/^whsec_/);
    expect(created.endpoint.createdBy).toBe(writer.user.id);
    const id = created.endpoint.id;
    const rotated = await api.rotateWebhookEndpointSecret.run(
      { params: { id }, query: {}, body: {} },
      writer,
    );
    expect(rotated.secret).toMatch(/^whsec_/);

    await shop.paid.send({ orderId: ORDER, total: 1 });
    await shop.background.flush();
    const [delivery] = await shop.deliveries.findMany();

    const responses: unknown[] = [
      await api.findWebhookEndpoints.run({ query: {} }, reader),
      await api.getWebhookEndpoint.run({ params: { id }, query: {} }, reader),
      await api.updateWebhookEndpoint.run(
        { params: { id }, query: {}, body: { description: "Fulfilment" } },
        writer,
      ),
      await api.enableWebhookEndpoint.run(
        { params: { id }, query: {} },
        writer,
      ),
      await api.findWebhookDeliveries.run({ query: {} }, reader),
      await api.getWebhookDelivery.run(
        { params: { id: delivery.id }, query: {} },
        reader,
      ),
      await api.sendTestWebhook.run({ params: { id }, query: {} }, writer),
      await api.redeliverWebhookDelivery.run(
        { params: { id: delivery.id }, query: {} },
        writer,
      ),
      await api.getWebhookEvents.run({}, reader),
    ];
    for (const response of responses) {
      const text = JSON.stringify(response);
      // `secretPrefix` (whsec_ and four characters) is shown by design.
      expect(text).not.toContain(created.secret.slice(6, 20));
      expect(text).not.toContain(rotated.secret.slice(6, 20));
      expect(text).not.toMatch(/"(previousSecret|secret)":/);
    }
  });

  it("updates, pauses and resumes (re-pushing pending deliveries), enables and deletes with its log", async ({
    expect,
  }) => {
    const { api, shop, transport } = await boot();
    const url = "https://example.app/hooks";
    const { endpoint } = await api.createWebhookEndpoint.run(
      { body: { url } },
      writer,
    );
    const id = endpoint.id;
    const paused = await api.updateWebhookEndpoint.run(
      { params: { id }, query: {}, body: { status: "paused" } },
      writer,
    );
    expect(paused.status).toBe("paused");

    // A delivery left pending while paused: the endpoint is paused before
    // its job runs.
    await shop.endpointRows.updateById(id, { status: "active" });
    await shop.endpointRows.updateById(id, { status: "paused" });
    await shop.deliveries.create({
      endpointId: id,
      eventType: "order.paid",
      eventId: "evt-pending",
      payload: {
        id: "evt-pending",
        type: "order.paid",
        timestamp: new Date(0).toISOString(),
        data: {},
      },
      status: "pending",
      attempt: 0,
    });
    const resumed = await api.updateWebhookEndpoint.run(
      { params: { id }, query: {}, body: { status: "active" } },
      writer,
    );
    expect(resumed.status).toBe("active");
    await shop.background.flush();
    expect(transport.deliveriesFor(url).map((it) => it.envelope.id)).toEqual([
      "evt-pending",
    ]);

    await shop.endpointRows.updateById(id, {
      status: "disabled",
      disabledReason: "gone",
      failingSince: new Date().toISOString(),
    });
    await expect(
      api.updateWebhookEndpoint.run(
        { params: { id }, query: {}, body: { status: "active" } },
        writer,
      ),
    ).rejects.toThrow(WebhookEndpointNotActiveError);
    const enabled = await api.enableWebhookEndpoint.run(
      { params: { id }, query: {} },
      writer,
    );
    expect(enabled.status).toBe("active");
    expect(enabled.disabledReason).toBeUndefined();
    expect(enabled.failingSince).toBeUndefined();

    await api.deleteWebhookEndpoint.run({ params: { id }, query: {} }, writer);
    expect(await shop.endpointRows.findMany()).toEqual([]);
    expect(await shop.deliveries.findMany()).toEqual([]);
  });

  it("finds endpoints by status, event and search, and deliveries by endpoint, event, status and date", async ({
    expect,
  }) => {
    const { api, shop } = await boot();
    const all = await api.createWebhookEndpoint.run(
      {
        body: {
          url: "https://all.example.app/hooks",
          description: "Accounting",
        },
      },
      writer,
    );
    const shipped = await api.createWebhookEndpoint.run(
      {
        body: {
          url: "https://ship.example.app/hooks",
          events: ["order.shipped"],
        },
      },
      writer,
    );
    const ids = async (query: Record<string, unknown>) =>
      (await api.findWebhookEndpoints.run({ query }, reader)).content
        .map((it) => it.id)
        .sort();
    expect(await ids({ event: "order.paid" })).toEqual([all.endpoint.id]);
    expect(await ids({ event: "order.shipped" })).toEqual(
      [all.endpoint.id, shipped.endpoint.id].sort(),
    );
    expect(await ids({ search: "accounting" })).toEqual([all.endpoint.id]);
    expect(await ids({ search: "ship.example" })).toEqual([
      shipped.endpoint.id,
    ]);
    expect(await ids({ status: "paused" })).toEqual([]);

    await shop.paid.send({ orderId: ORDER, total: 1 });
    await shop.shipped.send({ orderId: ORDER });
    await shop.background.flush();
    const deliveries = async (query: Record<string, unknown>) =>
      (await api.findWebhookDeliveries.run({ query }, reader)).content;
    expect(await deliveries({})).toHaveLength(3);
    expect(await deliveries({ endpointId: shipped.endpoint.id })).toHaveLength(
      1,
    );
    expect(await deliveries({ eventType: "order.paid" })).toHaveLength(1);
    expect(await deliveries({ status: "delivered" })).toHaveLength(3);
    expect(
      await deliveries({ from: new Date(Date.now() + 60_000).toISOString() }),
    ).toHaveLength(0);

    const [one] = await deliveries({ eventType: "order.paid" });
    const detail = await api.getWebhookDelivery.run(
      { params: { id: one.id }, query: {} },
      reader,
    );
    expect(detail.payload).toMatchObject({
      type: "order.paid",
      data: { orderId: ORDER, total: 1 },
    });
    expect(detail.responseExcerpt).toBe("ok");
    expect(detail.host).toBe("all.example.app");
  });

  it("redeliver writes a new row with the same event id, leaves the original, and is refused when the endpoint is not active", async ({
    expect,
  }) => {
    const { api, shop } = await boot();
    const { endpoint } = await api.createWebhookEndpoint.run(
      { body: { url: "https://example.app/hooks" } },
      writer,
    );
    await shop.paid.send({ orderId: ORDER, total: 1 });
    await shop.background.flush();
    const [original] = await shop.deliveries.findMany();

    const { deliveryId } = await api.redeliverWebhookDelivery.run(
      { params: { id: original.id }, query: {} },
      writer,
    );
    expect(deliveryId).not.toBe(original.id);
    await shop.background.flush();
    const copy = await shop.deliveries.getById(deliveryId);
    expect(copy.eventId).toBe(original.eventId);
    expect(copy.payload).toEqual(original.payload);
    expect(await shop.deliveries.getById(original.id)).toEqual(original);

    await shop.endpointRows.updateById(endpoint.id, { status: "paused" });
    await expect(
      api.redeliverWebhookDelivery.run(
        { params: { id: original.id }, query: {} },
        writer,
      ),
    ).rejects.toThrow(WebhookEndpointNotActiveError);
  });

  it("sendTestWebhook delivers webhook.test to one endpoint, whatever it subscribes to", async ({
    expect,
  }) => {
    const { api, shop, transport } = await boot();
    const url = "https://shipping-only.example.app/hooks";
    const { endpoint } = await api.createWebhookEndpoint.run(
      { body: { url, events: ["order.shipped"] } },
      writer,
    );
    await api.createWebhookEndpoint.run(
      { body: { url: "https://other.example.app/hooks" } },
      writer,
    );
    const { deliveryId } = await api.sendTestWebhook.run(
      { params: { id: endpoint.id }, query: {} },
      writer,
    );
    await shop.background.flush();
    expect(transport.wasDelivered("webhook.test", url)).toBe(true);
    expect(transport.requests).toHaveLength(1);
    expect((await shop.deliveries.getById(deliveryId)).status).toBe(
      "delivered",
    );
  });

  it("keeps a caller scoped to one tenant away from another's endpoints and deliveries", async ({
    expect,
  }) => {
    const { api, shop } = await boot();
    const a = await api.createWebhookEndpoint.run(
      { body: { url: "https://a.example.app/hooks", scope: "a" } },
      writer,
    );
    const b = await api.createWebhookEndpoint.run(
      { body: { url: "https://b.example.app/hooks", scope: "b" } },
      writer,
    );
    await shop.paid.send({ orderId: ORDER, total: 1 }, { scope: "b" });
    await shop.background.flush();
    const [bDelivery] = await shop.deliveries.findMany();

    const listed = await api.findWebhookEndpoints.run(
      { query: { scope: "a" } },
      reader,
    );
    expect(listed.content.map((it) => it.id)).toEqual([a.endpoint.id]);
    expect(
      (await api.findWebhookDeliveries.run({ query: { scope: "a" } }, reader))
        .content,
    ).toEqual([]);
    for (const call of [
      () =>
        api.getWebhookEndpoint.run(
          { params: { id: b.endpoint.id }, query: { scope: "a" } },
          reader,
        ),
      () =>
        api.updateWebhookEndpoint.run(
          {
            params: { id: b.endpoint.id },
            query: { scope: "a" },
            body: { description: "x" },
          },
          writer,
        ),
      () =>
        api.deleteWebhookEndpoint.run(
          { params: { id: b.endpoint.id }, query: { scope: "a" } },
          writer,
        ),
      () =>
        api.rotateWebhookEndpointSecret.run(
          { params: { id: b.endpoint.id }, query: { scope: "a" }, body: {} },
          writer,
        ),
      () =>
        api.getWebhookDelivery.run(
          { params: { id: bDelivery.id }, query: { scope: "a" } },
          reader,
        ),
      () =>
        api.redeliverWebhookDelivery.run(
          { params: { id: bDelivery.id }, query: { scope: "a" } },
          writer,
        ),
    ]) {
      await expect(call()).rejects.toThrow(NotFoundError);
    }
    expect(
      (
        await api.getWebhookEndpoint.run(
          { params: { id: b.endpoint.id }, query: { scope: "b" } },
          reader,
        )
      ).id,
    ).toBe(b.endpoint.id);
  });

  it("audits create, update, rotate, enable and delete, naming the host", async ({
    expect,
  }) => {
    const { api, shop } = await boot();
    const { endpoint } = await api.createWebhookEndpoint.run(
      { body: { url: "https://example.app/hooks?token=t0k3n" } },
      writer,
    );
    const id = endpoint.id;
    await api.updateWebhookEndpoint.run(
      { params: { id }, query: {}, body: { description: "x" } },
      writer,
    );
    await api.rotateWebhookEndpointSecret.run(
      { params: { id }, query: {}, body: {} },
      writer,
    );
    await api.enableWebhookEndpoint.run({ params: { id }, query: {} }, writer);
    await api.deleteWebhookEndpoint.run({ params: { id }, query: {} }, writer);
    const rows = await shop.audits.findMany({
      where: { type: { eq: "webhook-endpoint" } },
    });
    expect(rows.map((it) => it.action).sort()).toEqual(
      ["create", "delete", "enable", "rotate", "update"].sort(),
    );
    expect(JSON.stringify(rows)).not.toContain("t0k3n");
    expect(JSON.stringify(rows)).toContain("example.app");
  });

  describe("the event catalog and x-webhooks", () => {
    it("lists every $webhook with the JSON Schema of its data", async ({
      expect,
    }) => {
      const { api } = await boot();
      const events = await api.getWebhookEvents.run({}, reader);
      expect(events.map((it) => it.name).sort()).toEqual([
        "order.paid",
        "order.shipped",
        "webhook.test",
      ]);
      const paid = events.find((it) => it.name === "order.paid")!;
      expect(paid.description).toBe("An order was paid in full.");
      expect(paid.schema).toMatchObject({
        type: "object",
        properties: { orderId: { type: "string" }, total: { type: "number" } },
      });
    });

    it("the OpenAPI document stays 3.0.0 and lists the events under x-webhooks", async ({
      expect,
    }) => {
      const { alepha } = await boot();
      const doc = alepha.inject(ServerSwaggerProvider).generateSwaggerDoc({});
      expect(doc.openapi).toBe("3.0.0");
      const hooks = doc["x-webhooks"]!;
      expect(Object.keys(hooks).sort()).toEqual([
        "order.paid",
        "order.shipped",
        "webhook.test",
      ]);
      const post = hooks["order.paid"].post;
      expect(post.description).toBe("An order was paid in full.");
      expect(post.parameters.map((it: { name: string }) => it.name)).toEqual([
        "webhook-id",
        "webhook-timestamp",
        "webhook-signature",
      ]);
      const body = post.requestBody.content["application/json"].schema;
      expect(Object.keys(body.properties).sort()).toEqual([
        "data",
        "id",
        "timestamp",
        "type",
      ]);
      expect(body.properties.data.properties).toHaveProperty("total");
      expect(post.responses).toHaveProperty("2XX");
      expect(
        Object.keys(doc.paths).some((it) => it.includes("order.paid")),
      ).toBe(false);
    });

    it("an app with no $webhook has no x-webhooks key", async ({ expect }) => {
      class Plain {
        docs = $swagger({});
      }
      const alepha = Alepha.create().with(AlephaServerSwagger).with(Plain);
      const doc = alepha.inject(ServerSwaggerProvider).generateSwaggerDoc({});
      expect(doc).not.toHaveProperty("x-webhooks");
    });

    it("rewrite still sees, and can edit, x-webhooks", async ({ expect }) => {
      const { alepha } = await boot();
      const doc = alepha.inject(ServerSwaggerProvider).generateSwaggerDoc({
        rewrite: (json) => {
          delete json["x-webhooks"]!["webhook.test"];
        },
      });
      expect(Object.keys(doc["x-webhooks"]!)).not.toContain("webhook.test");
    });
  });
});
