import { $inject, Alepha, z } from "alepha";
import {
  $webhook,
  AlephaApiWebhooks,
  HttpWebhookTransport,
  MemoryWebhookTransport,
  WebhookDeliveryService,
  WebhookEndpointService,
  WebhookTransport,
  webhookDeliveryEntity,
  webhookEndpointEntity,
} from "alepha/api/webhooks";
import { BackgroundTaskProvider } from "alepha/background";
import { $repository, DatabaseProvider } from "alepha/orm";
import { $route, AlephaServer, ServerProvider } from "alepha/server";
import { afterAll, beforeAll, describe, it } from "vitest";

/**
 * One contract, two transports: the memory transport is only worth having
 * if the HTTP one gives the same answers. The HTTP one is pointed at a
 * `$route` in a second container; the memory one is scripted with the same
 * answers. Each case compares what the delivery log recorded, and the
 * request the receiver saw.
 */

interface Answer {
  status: number;
  body?: string;
  delayMs?: number;
}

interface Seen {
  headers: Record<string, string>;
  body: string;
}

/**
 * The HTTP receiver: answers what the spec scripts for the next request.
 */
const receiver = {
  next: { status: 200, body: "ok" } as Answer,
  seen: [] as Seen[],
  url: "",
  alepha: undefined as Alepha | undefined,
};

class Receiver {
  hooks = $route({
    method: "POST",
    path: "/hooks",
    handler: async (request) => {
      const req = request.raw.node?.req;
      let body = "";
      if (req) for await (const chunk of req) body += chunk;
      else body = (await request.raw.web?.req.text()) ?? "";
      receiver.seen.push({
        headers: { ...(request.headers as Record<string, string>) },
        body,
      });
      const answer = receiver.next;
      if (answer.delayMs) {
        await new Promise((r) => setTimeout(r, answer.delayMs));
      }
      request.reply.status = answer.status;
      if (answer.status >= 300 && answer.status < 400) {
        request.reply.headers.location = "http://127.0.0.1:1/elsewhere";
      }
      return answer.body ?? "";
    },
  });
}

beforeAll(async () => {
  receiver.alepha = Alepha.create({ env: { SERVER_PORT: 0 } })
    .with(AlephaServer)
    .with(Receiver);
  await receiver.alepha.start();
  receiver.url = `${receiver.alepha.inject(ServerProvider).hostname}/hooks`;
});

afterAll(async () => {
  await receiver.alepha?.stop();
});

class Shop {
  db = $inject(DatabaseProvider);
  background = $inject(BackgroundTaskProvider);
  endpoints = $inject(WebhookEndpointService);
  delivery = $inject(WebhookDeliveryService);
  deliveries = $repository(webhookDeliveryEntity);
  endpointRows = $repository(webhookEndpointEntity);
  paid = $webhook({
    name: "order.paid",
    description: "An order was paid in full.",
    schema: z.object({ orderId: z.text() }),
  });
}

/**
 * The two transports, each with its way to script the receiver's answer
 * and to read back what it saw.
 */
const transports = {
  memory: {
    use: MemoryWebhookTransport,
    script: (alepha: Alepha, answer: Answer) =>
      alepha.inject(MemoryWebhookTransport).respondOnce(receiver.url, answer),
    seen: (alepha: Alepha): Seen[] =>
      alepha.inject(MemoryWebhookTransport).deliveriesFor(receiver.url),
  },
  http: {
    use: HttpWebhookTransport,
    script: (_alepha: Alepha, answer: Answer) => {
      receiver.next = answer;
    },
    seen: (): Seen[] => receiver.seen,
  },
} as const;

/**
 * Send one event, and run its one attempt by hand: what the transport
 * answered, as the delivery log recorded it.
 */
const attempt = async (kind: keyof typeof transports, answer: Answer) => {
  receiver.seen = [];
  receiver.next = { status: 200, body: "ok" };
  const alepha = Alepha.create({
    env: { DATABASE_URL: "sqlite://:memory:" },
  })
    .with({ provide: WebhookTransport, use: transports[kind].use })
    .with(AlephaApiWebhooks);
  const shop = alepha.inject(Shop);
  await alepha.start();
  const transport = alepha.inject(WebhookTransport);
  (transport as unknown as { timeoutMs: number }).timeoutMs = 300;
  transports[kind].script(alepha, answer);

  const { endpoint, secret } = await shop.endpoints.create({
    url: receiver.url,
  });
  // Paused before its job runs, so the attempt below is the only one.
  await shop.db.transactional(async () => {
    await shop.paid.send({ orderId: "o1" });
    await shop.endpointRows.updateById(endpoint.id, { status: "paused" });
  });
  // Its job has found the endpoint paused and ended, before it is resumed.
  await shop.background.flush();
  await shop.endpointRows.updateById(endpoint.id, { status: "active" });
  const [row] = await shop.deliveries.findMany();
  const error = await shop.delivery
    .deliver(row.id, { attempt: 1, final: false })
    .then(() => undefined)
    .catch((e: Error) => e.message);
  const after = await shop.deliveries.getById(row.id);
  const endpointAfter = await shop.endpointRows.getById(endpoint.id);
  const seen = transports[kind].seen(alepha);
  await alepha.stop();
  return {
    thrown: error,
    status: after.status,
    responseStatus: after.responseStatus,
    responseExcerpt: after.responseExcerpt,
    error: after.error,
    endpointStatus: endpointAfter.status,
    requests: seen.length,
    headers: seen[0]
      ? Object.keys(seen[0].headers)
          .filter((it) => it.startsWith("webhook-") || it === "content-type")
          .sort()
      : [],
    envelope: seen[0] ? JSON.parse(seen[0].body).type : undefined,
    secretLength: secret.length,
  };
};

const cases: Array<[string, Answer]> = [
  ["a 200", { status: 200, body: "thanks" }],
  ["a 500", { status: 500, body: "boom" }],
  ["a 410", { status: 410, body: "gone" }],
  ["a 3xx", { status: 302 }],
  ["a timeout", { status: 200, delayMs: 1000 }],
];

describe("WebhookTransport contract", () => {
  for (const [label, answer] of cases) {
    it(`the memory and HTTP transports record the same outcome for ${label}`, async ({
      expect,
    }) => {
      const memory = await attempt("memory", answer);
      const http = await attempt("http", answer);
      expect(memory).toEqual(http);
      expect(memory.headers).toEqual([
        "content-type",
        "webhook-id",
        "webhook-signature",
        "webhook-timestamp",
      ]);
      expect(memory.envelope).toBe("order.paid");
    });
  }
});
