import { createHmac, timingSafeEqual } from "node:crypto";

import { Alepha } from "alepha";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { AlephaApiPayments } from "../index.ts";
import { MemoryPaymentProvider } from "../providers/MemoryPaymentProvider.ts";
import type { WebhookEvent } from "../providers/PaymentProvider.ts";
import { PaymentProvider } from "../providers/PaymentProvider.ts";
import { PaymentService } from "../services/PaymentService.ts";

const SECRET = "whsec_test";

const sign = (bytes: Uint8Array) =>
  createHmac("sha256", SECRET).update(bytes).digest("hex");

/**
 * A provider that verifies an HMAC over the exact bytes received, as a real
 * PSP does: anything that parsed and re-serialised the body would break it.
 */
class SignedPaymentProvider extends MemoryPaymentProvider {
  public override async parseWebhook(request: Request): Promise<WebhookEvent> {
    const bytes = new Uint8Array(await request.arrayBuffer());
    const expected = Buffer.from(sign(bytes), "hex");
    const received = Buffer.from(
      request.headers.get("x-signature") ?? "",
      "hex",
    );
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new Error("invalid webhook signature");
    }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    return { providerRef: body.providerRef, status: body.status, raw: body };
  }
}

const setup = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmTestPostgres)
    .with({ provide: PaymentProvider, use: SignedPaymentProvider })
    .with(AlephaApiPayments);
  const payments = alepha.inject(PaymentService);
  const server = alepha.inject(ServerProvider);
  await alepha.start();

  const intent = await payments.createIntent(1500, "eur");
  await payments.createSession(intent.id, "https://example.com/return");
  const providerRef = (await payments.getIntent(intent.id)).providerRef!;
  return { alepha, payments, server, intent, providerRef };
};

/**
 * The body as a PSP writes it: odd spacing and key order on purpose, so a
 * route that parsed and re-serialised it would send the provider other bytes.
 */
const eventBody = (providerRef: string) =>
  new TextEncoder().encode(
    `{ "status":"authorized",  "providerRef": "${providerRef}" }`,
  );

describe("POST /api/payments/webhook", () => {
  describe("on the Node HTTP server", () => {
    it("hands the provider the exact bytes and headers received", async ({
      expect,
    }) => {
      const { server, payments, intent, providerRef } = await setup();
      const body = eventBody(providerRef);

      const response = await fetch(`${server.hostname}/api/payments/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature": sign(body),
        },
        body: body as BodyInit,
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect((await payments.getIntent(intent.id)).status).toBe("authorized");
    });

    it("refuses a tampered body", async ({ expect }) => {
      const { server, payments, intent, providerRef } = await setup();
      const body = eventBody(providerRef);
      const tampered = new TextEncoder().encode(
        new TextDecoder().decode(body).replace("authorized", "captured"),
      );

      const response = await fetch(`${server.hostname}/api/payments/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature": sign(body),
        },
        body: tampered as BodyInit,
      });

      expect(response.status).toBe(500);
      expect((await payments.getIntent(intent.id)).status).toBe("processing");
    });
  });

  describe("on the web-request path (Bun, workerd)", () => {
    const send = async (server: ServerProvider, req: Request) => {
      const ev = { req, res: undefined as Response | undefined };
      await server.handleWebRequest(ev);
      return ev.res as Response;
    };

    const post = (body: Uint8Array, signature: string) =>
      new Request("http://localhost/api/payments/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature": signature,
        },
        body: body as BodyInit,
      });

    it("hands the provider the exact bytes and headers received", async ({
      expect,
    }) => {
      const { server, payments, intent, providerRef } = await setup();
      const body = eventBody(providerRef);

      const response = await send(server, post(body, sign(body)));

      expect(response.status).toBe(200);
      expect((await payments.getIntent(intent.id)).status).toBe("authorized");
    });

    it("refuses a tampered body", async ({ expect }) => {
      const { server, payments, intent, providerRef } = await setup();
      const body = eventBody(providerRef);
      const tampered = new TextEncoder().encode(
        new TextDecoder().decode(body).replace("authorized", "captured"),
      );

      const response = await send(server, post(tampered, sign(body)));

      expect(response.status).toBe(500);
      expect((await payments.getIntent(intent.id)).status).toBe("processing");
    });
  });
});
