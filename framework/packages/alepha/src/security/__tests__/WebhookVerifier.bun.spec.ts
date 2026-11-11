import { afterEach, describe, expect, it } from "bun:test";

import { $inject, Alepha } from "alepha";
import { $route, ServerProvider } from "alepha/server";

import { WebhookSigner } from "../providers/WebhookSigner.ts";
import { WebhookVerifier } from "../providers/WebhookVerifier.ts";

// ---------------------------------------------------------------------------------------------------------------------

describe("WebhookVerifier.verifyRequest on Bun", () => {
  let alepha: Alepha;

  afterEach(async () => {
    await alepha?.stop().catch(() => {});
  });

  it("reads the raw bytes of a $route without schema.body", async () => {
    const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    const received: unknown[] = [];
    class Receiver {
      verifier = $inject(WebhookVerifier);
      hooks = $route({
        method: "POST",
        path: "/hooks",
        handler: async (request) => {
          received.push(await this.verifier.verifyRequest(request, { secret }));
          return "ok";
        },
      });
    }
    alepha = Alepha.create({ env: { NODE_ENV: "test", SERVER_PORT: 0 } });
    await alepha.with(Receiver).start();
    const url = `${alepha.inject(ServerProvider).hostname}/hooks`;
    const body = '{ "id": "e1",  "type": "order.paid", "data": {} }';
    const headers = await alepha.inject(WebhookSigner).headers({
      id: "e1",
      timestamp: Math.floor(Date.now() / 1000),
      body,
      secrets: [secret],
    });
    const good = await fetch(url, { method: "POST", headers, body });
    expect(good.status).toBe(200);
    expect(received).toEqual([{ id: "e1", type: "order.paid", data: {} }]);
    const bad = await fetch(url, {
      method: "POST",
      headers,
      body: body.replace("  ", " "),
    });
    expect(bad.status).toBe(401);
  });
});
