import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { $hook, $inject, Alepha, z } from "alepha";
import {
  $webhook,
  AlephaApiWebhooks,
  MemoryWebhookTransport,
  WebhookAddressResolver,
  WebhookDeliveryService,
  WebhookDestinationPolicy,
  WebhookDestinationRefusedError,
  WebhookEndpointService,
  WebhookPayloadTooLargeError,
  WebhookTransport,
  webhookDeliveryEntity,
  webhookEndpointEntity,
  webhookOptions,
} from "alepha/api/webhooks";
import { BackgroundTaskProvider } from "alepha/background";
import { DateTimeProvider } from "alepha/datetime";
import {
  LogDestinationProvider,
  LogFormatterProvider,
  MemoryDestinationProvider,
  RawFormatterProvider,
} from "alepha/logger";
import { $repository, DatabaseProvider } from "alepha/orm";
import { WebhookVerifier } from "alepha/security";
import { describe, it } from "vitest";

/**
 * A resolver the spec scripts: host to addresses, or a failure.
 */
class ScriptedResolver extends WebhookAddressResolver {
  public answers = new Map<string, string[] | Error>();
  public asked: string[] = [];
  public override async resolve(host: string): Promise<string[]> {
    this.asked.push(host);
    const answer = this.answers.get(host) ?? ["93.184.216.34"];
    if (answer instanceof Error) throw answer;
    return answer;
  }
}

/**
 * The policy as it runs in production. A production container would need
 * migrations to boot; what differs is exactly `strict()`.
 */
class ProductionDestinationPolicy extends WebhookDestinationPolicy {
  protected override strict(): boolean {
    return !this.options.allowPrivateDestinations;
  }
}

class Events {
  errors: any[] = [];
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
  verifier = $inject(WebhookVerifier);
  deliveries = $repository(webhookDeliveryEntity);
  endpointRows = $repository(webhookEndpointEntity);
  paid = $webhook({
    name: "order.paid",
    description: "An order was paid in full.",
    schema: z.object({ orderId: z.text(), note: z.string().optional() }),
  });
}

const boot = async (
  options: { production?: boolean; resolver?: boolean } = {},
) => {
  const alepha = Alepha.create({
    env: {
      DATABASE_URL: "sqlite://:memory:",
      LOG_LEVEL: "debug",
    },
  })
    .with({ provide: LogDestinationProvider, use: MemoryDestinationProvider })
    .with({ provide: LogFormatterProvider, use: RawFormatterProvider })
    .with({ provide: WebhookTransport, use: MemoryWebhookTransport })
    .with(Events);
  if (options.production) {
    alepha.with({
      provide: WebhookDestinationPolicy,
      use: ProductionDestinationPolicy,
    });
  }
  if (options.resolver !== false) {
    alepha.with({ provide: WebhookAddressResolver, use: ScriptedResolver });
  }
  alepha.with(AlephaApiWebhooks);
  const shop = alepha.inject(Shop);
  await alepha.start();
  return {
    alepha,
    shop,
    policy: alepha.inject(WebhookDestinationPolicy),
    transport: alepha.inject(MemoryWebhookTransport),
    resolver: alepha.inject(WebhookAddressResolver) as ScriptedResolver,
    logs: alepha.inject(MemoryDestinationProvider),
    events: alepha.inject(Events),
  };
};

const refusal = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    if (error instanceof WebhookDestinationRefusedError) {
      return error.data.issues?.[0]?.path;
    }
    throw error;
  }
  return undefined;
};

/**
 * Send one event whose job finds the endpoint paused, then run its attempt
 * by hand: the spec owns the only attempt.
 */
const oneAttempt = async (shop: Shop, url: string) => {
  const { endpoint, secret } = await shop.endpoints.create({ url });
  await shop.db.transactional(async () => {
    await shop.paid.send({ orderId: "o1" });
    await shop.endpointRows.updateById(endpoint.id, { status: "paused" });
  });
  // Its job has found the endpoint paused and ended, before it is resumed.
  await shop.background.flush();
  await shop.endpointRows.updateById(endpoint.id, { status: "active" });
  const [delivery] = await shop.deliveries.findMany({
    where: { endpointId: { eq: endpoint.id } },
  });
  const thrown = await shop.delivery
    .deliver(delivery.id, { attempt: 1, final: false })
    .then(() => undefined)
    .catch((error: Error) => error.message);
  return {
    endpoint,
    secret,
    thrown,
    delivery: await shop.deliveries.getById(delivery.id),
  };
};

describe("WebhookDestinationPolicy", () => {
  describe("the literal rules, in production", () => {
    it("refuses http, credentials, fragments and unlisted ports", async ({
      expect,
    }) => {
      const { alepha, policy } = await boot({ production: true });
      for (const url of [
        "http://example.app/hooks",
        "https://user:pass@example.app/hooks",
        "https://example.app/hooks#frag",
        "https://example.app:8443/hooks",
        "ftp://example.app/hooks",
        "not a url",
      ]) {
        expect(
          refusal(() => policy.checkUrl(url)),
          url,
        ).toBe("/url");
      }
      expect(refusal(() => policy.checkUrl("https://example.app/hooks"))).toBe(
        undefined,
      );
      alepha.store.set(webhookOptions, {
        ...alepha.store.get(webhookOptions)!,
        allowedPorts: [8443],
      });
      expect(
        refusal(() => policy.checkUrl("https://example.app:8443/hooks")),
      ).toBe(undefined);
    });

    it("refuses private, loopback, link-local, unique-local, metadata and local-name hosts, in every spelling", async ({
      expect,
    }) => {
      const { policy } = await boot({ production: true });
      for (const host of [
        "localhost",
        "app.localhost",
        "printer.local",
        "metadata.google.internal",
        "metadata",
        "intranet",
        "10.0.0.5",
        "172.16.3.4",
        "192.168.1.1",
        "127.0.0.1",
        "127.1",
        "2130706433",
        "0x7f.0.0.1",
        "0177.0.0.1",
        "0.0.0.0",
        "169.254.169.254",
        "100.100.100.200",
        "[::1]",
        "[::]",
        "[::ffff:127.0.0.1]",
        "[::ffff:10.0.0.5]",
        "[64:ff9b::a00:5]",
        "[fd00:ec2::254]",
        "[fc00::1]",
        "[fe80::1]",
        "[ff02::1]",
      ]) {
        expect(
          refusal(() => policy.checkUrl(`https://${host}/hooks`)),
          host,
        ).toBe("/url");
      }
      for (const host of [
        "example.app",
        "8.8.8.8",
        "[2606:4700:4700::1111]",
        "hooks.acme.com",
      ]) {
        expect(
          refusal(() => policy.checkUrl(`https://${host}/hooks`)),
          host,
        ).toBe(undefined);
      }
    });

    it("names the host, never the URL, in its refusal", async ({ expect }) => {
      const { policy } = await boot({ production: true });
      try {
        policy.checkUrl("https://10.0.0.5/hooks?token=s3cr3t-value");
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(WebhookDestinationRefusedError);
        const refused = error as WebhookDestinationRefusedError;
        expect(refused.data.status).toBe(400);
        expect(refused.message).toContain("10.0.0.5");
        expect(JSON.stringify(refused.data)).not.toContain("s3cr3t");
        expect(refused.message).not.toContain("s3cr3t");
      }
    });

    it("allowPrivateDestinations lets an internal receiver through", async ({
      expect,
    }) => {
      const { alepha, policy } = await boot({ production: true });
      alepha.store.set(webhookOptions, {
        ...alepha.store.get(webhookOptions)!,
        allowPrivateDestinations: true,
      });
      expect(
        refusal(() => policy.checkUrl("https://10.0.0.5:8080/hooks")),
      ).toBe(undefined);
      expect(refusal(() => policy.checkUrl("https://u:p@10.0.0.5/hooks"))).toBe(
        "/url",
      );
    });

    it("outside production, a developer can point at localhost over http", async ({
      expect,
    }) => {
      const { policy } = await boot();
      expect(
        refusal(() => policy.checkUrl("http://localhost:3000/hooks")),
      ).toBe(undefined);
      expect(
        refusal(() => policy.checkUrl("http://u:p@localhost:3000/hooks")),
      ).toBe("/url");
    });

    it("applies at create and at URL edit, on the url field, and nothing is resolved then", async ({
      expect,
    }) => {
      const { shop, resolver } = await boot({ production: true });
      await expect(
        shop.endpoints.create({ url: "https://10.0.0.5/hooks" }),
      ).rejects.toBeInstanceOf(WebhookDestinationRefusedError);
      expect(await shop.endpointRows.findMany()).toEqual([]);

      const { endpoint } = await shop.endpoints.create({
        url: "https://not-yet-resolving.example.app/hooks",
      });
      await expect(
        shop.endpoints.update(endpoint.id, { url: "https://localhost/hooks" }),
      ).rejects.toBeInstanceOf(WebhookDestinationRefusedError);
      expect((await shop.endpointRows.getById(endpoint.id)).url).toBe(
        "https://not-yet-resolving.example.app/hooks",
      );
      expect(resolver.asked).toEqual([]);
    });
  });

  describe("the resolved check at delivery (Node and Bun)", () => {
    it("refuses a name resolving to a private address and fetches nothing; the attempt is a retried failure", async ({
      expect,
    }) => {
      const { shop, transport, resolver, events } = await boot({
        production: true,
      });
      resolver.answers.set("evil.example.app", ["10.0.0.5"]);
      const { thrown, delivery } = await oneAttempt(
        shop,
        "https://evil.example.app/hooks",
      );
      expect(transport.requests).toEqual([]);
      expect(thrown).toContain("refused");
      expect(delivery.status).toBe("pending");
      expect(delivery.attempt).toBe(1);
      expect(delivery.error).toContain("resolves to a private address");
      expect(events.errors.at(-1)).toMatchObject({
        host: "evil.example.app",
        final: false,
      });
      const endpoint = await shop.endpointRows.getById(delivery.endpointId);
      expect(endpoint.failingSince).toBeDefined();
    });

    it("refuses when one answer of several is private, and an IPv4-mapped answer", async ({
      expect,
    }) => {
      const { shop, transport, resolver } = await boot({ production: true });
      resolver.answers.set("mixed.example.app", ["93.184.216.34", "10.1.2.3"]);
      resolver.answers.set("mapped.example.app", ["::ffff:169.254.169.254"]);
      const mixed = await oneAttempt(shop, "https://mixed.example.app/hooks");
      const mapped = await oneAttempt(shop, "https://mapped.example.app/hooks");
      expect(mixed.delivery.error).toContain("private address");
      expect(mapped.delivery.error).toContain("private address");
      expect(transport.requests).toEqual([]);
    });

    it("a failed lookup is a failed attempt", async ({ expect }) => {
      const { shop, transport, resolver } = await boot({ production: true });
      resolver.answers.set(
        "gone.example.app",
        new Error("getaddrinfo ENOTFOUND gone.example.app"),
      );
      const { thrown, delivery } = await oneAttempt(
        shop,
        "https://gone.example.app/hooks",
      );
      expect(thrown).toContain("ENOTFOUND");
      expect(delivery.error).toContain("ENOTFOUND");
      expect(transport.requests).toEqual([]);
    });

    it("a public answer delivers", async ({ expect }) => {
      const { shop, transport } = await boot({ production: true });
      const { delivery } = await oneAttempt(
        shop,
        "https://ok.example.app/hooks",
      );
      expect(delivery.status).toBe("delivered");
      expect(transport.requests).toHaveLength(1);
    });

    it("the Node build wires the real resolver; the default one resolves nothing, so only the literal rules run", async ({
      expect,
    }) => {
      const { alepha } = await boot({ production: true, resolver: false });
      expect(alepha.inject(WebhookAddressResolver).constructor.name).toBe(
        "NodeWebhookAddressResolver",
      );
      // The runtime-neutral default, as the workerd build keeps it. Named
      // first: the first substitution wins over the Node build's.
      class WorkerdResolver extends WebhookAddressResolver {}
      const neutral = Alepha.create()
        .with({ provide: WebhookAddressResolver, use: WorkerdResolver })
        .with({
          provide: WebhookDestinationPolicy,
          use: ProductionDestinationPolicy,
        });
      const policy = neutral.inject(WebhookDestinationPolicy);
      expect(
        await neutral.inject(WebhookAddressResolver).resolve("example.app"),
      ).toBeUndefined();
      await expect(
        policy.checkDelivery("https://anything.example.app/x"),
      ).resolves.toBeUndefined();
      await expect(
        policy.checkDelivery("https://10.0.0.5/x"),
      ).rejects.toBeInstanceOf(WebhookDestinationRefusedError);
    });
  });

  it("the workerd barrel never reaches node:dns", async ({ expect }) => {
    const dir = join(import.meta.dirname, "..");
    const workerd = await readFile(join(dir, "index.workerd.ts"), "utf8");
    const shared = await readFile(join(dir, "index.shared.ts"), "utf8");
    const resolver = await readFile(
      join(dir, "services/NodeWebhookAddressResolver.ts"),
      "utf8",
    );
    expect(workerd).not.toContain("NodeWebhookAddressResolver");
    expect(shared).not.toContain("NodeWebhookAddressResolver");
    expect(shared).not.toContain("node:dns");
    expect(resolver).toContain('import * as dns from "node:dns"');
  });

  it("an envelope over 256 KB fails send with a typed error before any write", async ({
    expect,
  }) => {
    const { shop } = await boot();
    await shop.endpoints.create({ url: "https://example.app/hooks" });
    await expect(
      shop.paid.send({ orderId: "o1", note: "x".repeat(300 * 1024) }),
    ).rejects.toBeInstanceOf(WebhookPayloadTooLargeError);
    expect(await shop.deliveries.findMany()).toEqual([]);
  });

  describe("secret rotation", () => {
    it("returns the new secret once, keeps the old one signing for 24 hours, and expireNow drops it", async ({
      expect,
    }) => {
      const { alepha, shop, transport } = await boot();
      const time = alepha.inject(DateTimeProvider);
      const now = time.pause();
      const { endpoint, secret: first } = await shop.endpoints.create({
        url: "https://example.app/hooks",
      });
      const rotated = await shop.endpoints.rotateSecret(endpoint.id);
      expect(rotated.secret).not.toBe(first);
      expect(rotated.secret).toMatch(/^whsec_/);
      expect(rotated.endpoint.secretPrefix).toBe(rotated.secret.slice(0, 10));
      expect(rotated.endpoint.hasPreviousSecret).toBe(true);
      expect(rotated.endpoint.previousSecretExpiresAt).toBe(
        now.add(24, "hours").toISOString(),
      );
      expect(rotated.endpoint).not.toHaveProperty("secret");
      expect(rotated.endpoint).not.toHaveProperty("previousSecret");

      await shop.paid.send({ orderId: "o1" });
      await new Promise((r) => setTimeout(r, 100));
      const [request] = transport.requests;
      expect(request.headers["webhook-signature"].split(" ")).toHaveLength(2);
      for (const secret of [first, rotated.secret]) {
        await expect(
          shop.verifier.verify({
            headers: request.headers,
            body: request.body,
            secret,
          }),
        ).resolves.toBeUndefined();
      }

      const leaked = await shop.endpoints.rotateSecret(endpoint.id, {
        expireNow: true,
      });
      expect(leaked.endpoint.hasPreviousSecret).toBe(false);
      expect(leaked.endpoint.previousSecretExpiresAt).toBeUndefined();
    });
  });

  it("no log line, error column or hook payload carries an endpoint URL", async ({
    expect,
  }) => {
    const { shop, transport, logs, events } = await boot();
    const url = "https://hooks.example.app/in?token=never-log-this";
    transport.respondOnce(url, { status: 500 });
    const { delivery, endpoint } = await oneAttempt(shop, url);
    await shop.endpoints.rotateSecret(endpoint.id);
    await shop.endpoints.resume(endpoint.id);
    await new Promise((r) => setTimeout(r, 100));
    const written = JSON.stringify(logs.logs);
    expect(written).toContain("hooks.example.app");
    expect(written).not.toContain("never-log-this");
    expect(delivery.error).not.toContain("never-log-this");
    expect(JSON.stringify(events.errors)).not.toContain("never-log-this");
  });
});
