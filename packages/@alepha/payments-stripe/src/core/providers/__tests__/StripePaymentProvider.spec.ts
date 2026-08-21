import { Alepha, AlephaError } from "alepha";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { StripePaymentProvider } from "../StripePaymentProvider.ts";

const PLATFORM_SECRET = "whsec_test_platform_secret";
const CONNECT_SECRET = "whsec_test_connect_secret";

class TestStripeProvider extends StripePaymentProvider {
  /**
   * Swap the SDK client for a stub returning a canned checkout session.
   * The client is built in the constructor from STRIPE_SECRET_KEY, so it
   * is not DI-substitutable; tests that exercise response handling
   * replace it here instead of going through the network.
   */
  public stubSessionCreate(session: { id: string; url: string | null }) {
    (this as unknown as { stripe: unknown }).stripe = {
      checkout: { sessions: { create: async () => session } },
    };
  }
}

const make = (env: Record<string, string> = {}) =>
  Alepha.create({
    env: {
      STRIPE_SECRET_KEY: "sk_test_dummyKeyForUnitTests",
      STRIPE_WEBHOOK_SECRET: PLATFORM_SECRET,
      ...env,
    },
  }).inject(TestStripeProvider);

const sign = (payload: string, secret: string) =>
  new Stripe("sk_test_dummyKeyForUnitTests").webhooks.generateTestHeaderString({
    payload,
    secret,
  });

const webhookRequest = (event: object, secret = PLATFORM_SECRET) => {
  const payload = JSON.stringify(event);
  return new Request("https://app.test/api/payments/webhook", {
    method: "POST",
    body: payload,
    headers: { "stripe-signature": sign(payload, secret) },
  });
};

const piEvent = (type: string, id = "pi_123") => ({
  id: "evt_1",
  object: "event",
  type,
  data: { object: { object: "payment_intent", id } },
});

const sessionEvent = (
  type: string,
  paymentIntent: string | null,
  account?: string,
) => ({
  id: "evt_2",
  object: "event",
  type,
  account,
  data: {
    object: {
      object: "checkout.session",
      id: "cs_test_123",
      payment_intent: paymentIntent,
    },
  },
});

describe("StripePaymentProvider", () => {
  describe("parseWebhook status mapping", () => {
    it("maps payment_intent.succeeded to captured", async () => {
      const event = await make().parseWebhook(
        webhookRequest(piEvent("payment_intent.succeeded")),
      );
      expect(event.status).toBe("captured");
      expect(event.providerRef).toBe("pi_123");
    });

    it("maps payment_intent.amount_capturable_updated to authorized", async () => {
      const event = await make().parseWebhook(
        webhookRequest(piEvent("payment_intent.amount_capturable_updated")),
      );
      expect(event.status).toBe("authorized");
    });

    it("maps payment failure and cancellation to failed", async () => {
      const provider = make();
      const failed = await provider.parseWebhook(
        webhookRequest(piEvent("payment_intent.payment_failed")),
      );
      expect(failed.status).toBe("failed");
      const canceled = await provider.parseWebhook(
        webhookRequest(piEvent("payment_intent.canceled")),
      );
      expect(canceled.status).toBe("failed");
    });

    it("passes unmapped event types through as the status", async () => {
      const event = await make().parseWebhook(
        webhookRequest(piEvent("payment_intent.processing")),
      );
      expect(event.status).toBe("payment_intent.processing");
    });

    it("rejects a request without a stripe-signature header", async () => {
      const request = new Request("https://app.test/api/payments/webhook", {
        method: "POST",
        body: JSON.stringify(piEvent("payment_intent.succeeded")),
      });
      await expect(make().parseWebhook(request)).rejects.toThrow(AlephaError);
    });

    it("rejects a body signed with the wrong secret", async () => {
      const request = webhookRequest(
        piEvent("payment_intent.succeeded"),
        "whsec_wrong_secret",
      );
      await expect(make().parseWebhook(request)).rejects.toThrow();
    });
  });

  describe("checkout-session ref selection", () => {
    it("surfaces the session id and the payment intent as the alternate ref", async () => {
      const event = await make().parseWebhook(
        webhookRequest(sessionEvent("checkout.session.completed", "pi_777")),
      );
      expect(event.status).toBe("captured");
      expect(event.providerRef).toBe("cs_test_123");
      expect(event.providerRefAlt).toBe("pi_777");
    });

    it("omits the alternate ref when the payment intent was created lazily", async () => {
      const event = await make().parseWebhook(
        webhookRequest(sessionEvent("checkout.session.completed", null)),
      );
      expect(event.providerRef).toBe("cs_test_123");
      expect(event.providerRefAlt).toBeUndefined();
    });

    it("maps checkout.session.expired to failed", async () => {
      const event = await make().parseWebhook(
        webhookRequest(sessionEvent("checkout.session.expired", null)),
      );
      expect(event.status).toBe("failed");
    });
  });

  describe("parseConnectWebhook", () => {
    it("throws when STRIPE_CONNECT_WEBHOOK_SECRET is not configured", async () => {
      await expect(
        make().parseConnectWebhook(
          webhookRequest(piEvent("payment_intent.succeeded")),
        ),
      ).rejects.toThrow(AlephaError);
    });

    it("verifies with the connect secret and surfaces the account", async () => {
      const provider = make({ STRIPE_CONNECT_WEBHOOK_SECRET: CONNECT_SECRET });
      const event = await provider.parseConnectWebhook(
        webhookRequest(
          sessionEvent("checkout.session.completed", "pi_9", "acct_42"),
          CONNECT_SECRET,
        ),
      );
      expect(event.status).toBe("captured");
      expect(event.account).toBe("acct_42");
    });

    it("rejects a connect webhook signed with the platform secret", async () => {
      const provider = make({ STRIPE_CONNECT_WEBHOOK_SECRET: CONNECT_SECRET });
      await expect(
        provider.parseConnectWebhook(
          webhookRequest(piEvent("payment_intent.succeeded"), PLATFORM_SECRET),
        ),
      ).rejects.toThrow();
    });
  });

  describe("checkout session creation errors", () => {
    it("createCheckoutSetup throws AlephaError when the session has no url", async () => {
      const provider = make();
      provider.stubSessionCreate({ id: "cs_1", url: null });
      await expect(
        provider.createCheckoutSetup({
          successUrl: "https://app.test/ok",
          cancelUrl: "https://app.test/ko",
        }),
      ).rejects.toThrow(AlephaError);
    });

    it("createCheckoutSubscription throws AlephaError when the session has no url", async () => {
      const provider = make();
      provider.stubSessionCreate({ id: "cs_2", url: null });
      await expect(
        provider.createCheckoutSubscription({
          priceId: "price_1",
          successUrl: "https://app.test/ok",
          cancelUrl: "https://app.test/ko",
        }),
      ).rejects.toThrow(AlephaError);
    });
  });
});
