import { createHmac } from "node:crypto";

import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { StripePaymentProvider } from "../providers/StripePaymentProvider.ts";

/**
 * A Stripe webhook is trusted only on its signature: anyone can POST to the
 * endpoint, and a forged `payment_intent.succeeded` would mark an unpaid
 * order paid. Signed here the way Stripe signs (`t=<unix>,v1=<HMAC-SHA256 of
 * "t.body">`), and verified by the real `constructEventAsync`; no network.
 */
const SECRET = "whsec_test_secret";
const CONNECT_SECRET = "whsec_connect_secret";

const boot = (env: Record<string, string> = {}) =>
  Alepha.create({
    env: {
      STRIPE_SECRET_KEY: "sk_test_dummy",
      STRIPE_WEBHOOK_SECRET: SECRET,
      ...env,
    },
  }).inject(StripePaymentProvider);

const payload = JSON.stringify({
  id: "evt_1",
  object: "event",
  type: "payment_intent.succeeded",
  data: { object: { object: "payment_intent", id: "pi_123" } },
});

const sign = (
  body: string,
  secret: string,
  timestamp = Math.floor(new Date().getTime() / 1000),
) => {
  const v1 = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `t=${timestamp},v1=${v1}`;
};

const delivery = (body: string, signature?: string) =>
  new Request("https://app.example/payments/webhook", {
    method: "POST",
    body,
    headers: signature ? { "stripe-signature": signature } : {},
  });

describe("Stripe webhook signature", () => {
  it("accepts a delivery signed with the endpoint's secret, and maps it", async () => {
    const provider = boot();

    const event = await provider.parseWebhook(
      delivery(payload, sign(payload, SECRET)),
    );

    expect(event.providerRef).toBe("pi_123");
    expect(event.status).toBe("captured");
  });

  it("refuses a delivery with no signature", async () => {
    const provider = boot();

    await expect(provider.parseWebhook(delivery(payload))).rejects.toThrow(
      /stripe-signature/,
    );
  });

  it("refuses a delivery signed with another secret", async () => {
    const provider = boot();

    await expect(
      provider.parseWebhook(delivery(payload, sign(payload, "whsec_forged"))),
    ).rejects.toThrow();
  });

  it("refuses a body changed after it was signed", async () => {
    const provider = boot();
    const tampered = payload.replace("pi_123", "pi_999");

    await expect(
      provider.parseWebhook(delivery(tampered, sign(payload, SECRET))),
    ).rejects.toThrow();
  });

  it("refuses a replayed delivery past the timestamp tolerance", async () => {
    const provider = boot();
    const anHourAgo = Math.floor(new Date().getTime() / 1000) - 3600;

    await expect(
      provider.parseWebhook(
        delivery(payload, sign(payload, SECRET, anHourAgo)),
      ),
    ).rejects.toThrow();
  });

  it("verifies a connect delivery with the connect secret only", async () => {
    const provider = boot({ STRIPE_CONNECT_WEBHOOK_SECRET: CONNECT_SECRET });

    const event = await provider.parseConnectWebhook(
      delivery(payload, sign(payload, CONNECT_SECRET)),
    );
    expect(event.providerRef).toBe("pi_123");

    await expect(
      provider.parseConnectWebhook(delivery(payload, sign(payload, SECRET))),
    ).rejects.toThrow();
  });
});
