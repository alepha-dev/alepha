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

  /**
   * Swap the Checkout and Subscriptions APIs for recorders: every call's
   * params and request options land in `calls`.
   */
  public recordBilling(): Array<{
    call: string;
    params: unknown;
    options: unknown;
  }> {
    const calls: Array<{ call: string; params: unknown; options: unknown }> =
      [];
    const subscription = { id: "sub_1", object: "subscription" };
    (this as unknown as { stripe: unknown }).stripe = {
      checkout: {
        sessions: {
          create: async (params: unknown, options: unknown) => {
            calls.push({ call: "checkout", params, options });
            return { id: "cs_1", url: "https://checkout.test/cs_1" };
          },
        },
      },
      subscriptions: {
        retrieve: async (_id: string, params: unknown, options: unknown) => {
          calls.push({ call: "retrieve", params, options });
          return subscription;
        },
        update: async (_id: string, params: unknown, options: unknown) => {
          calls.push({ call: "update", params, options });
          return subscription;
        },
        cancel: async (_id: string, params: unknown, options: unknown) => {
          calls.push({ call: "cancel", params, options });
          return subscription;
        },
      },
    };
    return calls;
  }

  /**
   * Swap the v2 accounts API for a stub: `retrieve` answers `account`, and
   * every `create` call's params are recorded in the returned array.
   */
  public stubAccounts(account: {
    id: string;
    display_name?: string;
    metadata: Record<string, string>;
  }): Array<Record<string, unknown>> {
    const created: Array<Record<string, unknown>> = [];
    (this as unknown as { stripe: unknown }).stripe = {
      v2: {
        core: {
          accountTokens: { create: async () => ({ id: "acct_token_1" }) },
          accounts: {
            create: async (params: Record<string, unknown>) => {
              created.push(params);
              return account;
            },
            retrieve: async () => account,
          },
        },
      },
    };
    return created;
  }

  /**
   * Swap the lookups of checkout sessions and PaymentIntents for stubs that
   * answer a paid session / a succeeded PaymentIntent, recording the request
   * options of every call (where the connected account travels).
   */
  public stubLookups(): Array<{ id: string; requestOptions: unknown }> {
    const calls: Array<{ id: string; requestOptions: unknown }> = [];
    (this as unknown as { stripe: unknown }).stripe = {
      checkout: {
        sessions: {
          retrieve: async (id: string, _params: unknown, options: unknown) => {
            calls.push({ id, requestOptions: options });
            return { id, payment_status: "paid", status: "complete" };
          },
        },
      },
      paymentIntents: {
        retrieve: async (id: string, _params: unknown, options: unknown) => {
          calls.push({ id, requestOptions: options });
          return { id, status: "succeeded" };
        },
      },
    };
    return calls;
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
  paymentStatus: "paid" | "unpaid" = "paid",
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
      payment_status: paymentStatus,
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

    it("does not treat an unpaid completion as a capture", async () => {
      // A delayed-notification method (SEPA debit, bank transfer) completes
      // the session before the money arrives; marking the order paid here
      // shipped goods, issued the invoice and mailed the buyer on credit.
      const event = await make().parseWebhook(
        webhookRequest(
          sessionEvent(
            "checkout.session.completed",
            "pi_777",
            undefined,
            "unpaid",
          ),
        ),
      );
      expect(event.status).not.toBe("captured");
    });

    it("maps the async payment outcome events", async () => {
      const succeeded = await make().parseWebhook(
        webhookRequest(
          sessionEvent("checkout.session.async_payment_succeeded", "pi_777"),
        ),
      );
      expect(succeeded.status).toBe("captured");
      const failed = await make().parseWebhook(
        webhookRequest(
          sessionEvent("checkout.session.async_payment_failed", "pi_777"),
        ),
      );
      expect(failed.status).toBe("failed");
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

  describe("subscriptions on a connected account", () => {
    it("opens the checkout on the account, with the interval count and the one-off items", async () => {
      const provider = make();
      const calls = provider.recordBilling();

      const result = await provider.createCheckoutSubscription({
        priceData: {
          currency: "eur",
          unitAmount: 5000,
          interval: "month",
          intervalCount: 3,
          productName: "Membre annuel (1/4)",
        },
        oneOffItems: [
          {
            currency: "eur",
            unitAmount: 1500,
            productName: "Frais de dossier",
          },
        ],
        successUrl: "https://club.test/ok",
        cancelUrl: "https://club.test/ko",
        customerEmail: "ana@club.test",
        metadata: { orderId: "o_1" },
        stripeAccount: "acct_club",
      });

      expect(result).toEqual({
        url: "https://checkout.test/cs_1",
        sessionId: "cs_1",
      });
      expect(calls[0]).toEqual({
        call: "checkout",
        options: { stripeAccount: "acct_club" },
        params: {
          mode: "subscription",
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "eur",
                unit_amount: 5000,
                recurring: { interval: "month", interval_count: 3 },
                product_data: { name: "Membre annuel (1/4)" },
              },
            },
            {
              quantity: 1,
              price_data: {
                currency: "eur",
                unit_amount: 1500,
                product_data: { name: "Frais de dossier" },
              },
            },
          ],
          success_url: "https://club.test/ok",
          cancel_url: "https://club.test/ko",
          customer: undefined,
          customer_email: "ana@club.test",
          metadata: { orderId: "o_1" },
          subscription_data: { metadata: { orderId: "o_1" } },
        },
      });
    });

    it("stays on the platform account without stripeAccount", async () => {
      const provider = make();
      const calls = provider.recordBilling();

      await provider.createCheckoutSubscription({
        priceData: {
          currency: "eur",
          unitAmount: 7900,
          interval: "month",
          productName: "PRO",
        },
        successUrl: "https://app.test/ok",
        cancelUrl: "https://app.test/ko",
      });

      const [checkout] = calls;
      expect(checkout.options).toBeUndefined();
      expect((checkout.params as { line_items: unknown[] }).line_items).toEqual(
        [
          {
            quantity: 1,
            price_data: {
              currency: "eur",
              unit_amount: 7900,
              recurring: { interval: "month" },
              product_data: { name: "PRO" },
            },
          },
        ],
      );
    });

    it("opens a trial with Stripe Tax, the VAT number and the billing address", async () => {
      const provider = make();
      const calls = provider.recordBilling();

      await provider.createCheckoutSubscription({
        priceData: {
          currency: "eur",
          unitAmount: 7900,
          interval: "month",
          productName: "Alepha Club",
          taxBehavior: "exclusive",
        },
        successUrl: "https://app.test/ok",
        cancelUrl: "https://app.test/ko",
        customerEmail: "owner@club.test",
        metadata: { clubId: "c_1" },
        trialPeriodDays: 30,
        automaticTax: true,
        taxIdCollection: true,
        billingAddressCollection: "required",
      });

      const params = calls[0].params as Record<string, unknown>;
      expect(params.line_items).toEqual([
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: 7900,
            recurring: { interval: "month" },
            product_data: { name: "Alepha Club" },
            tax_behavior: "exclusive",
          },
        },
      ]);
      expect(params.subscription_data).toEqual({
        metadata: { clubId: "c_1" },
        trial_period_days: 30,
      });
      expect(params.automatic_tax).toEqual({ enabled: true });
      expect(params.tax_id_collection).toEqual({ enabled: true });
      expect(params.billing_address_collection).toBe("required");
      // A new customer is created from the email: nothing to write back.
      expect(params.customer_update).toBeUndefined();
    });

    it("saves the collected address onto a known customer when tax is on", async () => {
      const provider = make();
      const calls = provider.recordBilling();

      await provider.createCheckoutSubscription({
        priceData: {
          currency: "eur",
          unitAmount: 7900,
          interval: "month",
          productName: "Alepha Club",
        },
        successUrl: "https://app.test/ok",
        cancelUrl: "https://app.test/ko",
        customerId: "cus_1",
        automaticTax: true,
      });

      const params = calls[0].params as Record<string, unknown>;
      expect(params.customer).toBe("cus_1");
      expect(params.customer_update).toEqual({ address: "auto", name: "auto" });
      expect(params.subscription_data).toBeUndefined();
    });

    it("changes a subscription's price from its next invoice, keeping the rest", async () => {
      const provider = make();
      const calls: Array<{ call: string; id: string; params: unknown }> = [];
      (provider as unknown as { stripe: unknown }).stripe = {
        subscriptions: {
          retrieve: async (id: string) => {
            calls.push({ call: "retrieve", id, params: undefined });
            return {
              id,
              items: {
                data: [
                  {
                    id: "si_1",
                    price: {
                      currency: "eur",
                      product: "prod_1",
                      tax_behavior: "exclusive",
                      recurring: { interval: "month", interval_count: 1 },
                    },
                  },
                ],
              },
            };
          },
          update: async (id: string, params: unknown) => {
            calls.push({ call: "update", id, params });
            return { id };
          },
        },
      };

      await provider.updateSubscriptionPrice("sub_1", 0);

      expect(calls[1]).toEqual({
        call: "update",
        id: "sub_1",
        params: {
          items: [
            {
              id: "si_1",
              price_data: {
                currency: "eur",
                product: "prod_1",
                unit_amount: 0,
                recurring: { interval: "month", interval_count: 1 },
                tax_behavior: "exclusive",
              },
            },
          ],
          proration_behavior: "none",
        },
      });
    });

    it("moves a subscription off the inactive product Checkout created, to a new active one", async () => {
      const provider = make();
      const calls: Array<{ call: string; id?: string; params: unknown }> = [];
      (provider as unknown as { stripe: unknown }).stripe = {
        subscriptions: {
          retrieve: async (id: string, params: unknown) => {
            calls.push({ call: "retrieve", id, params });
            return {
              id,
              items: {
                data: [
                  {
                    id: "si_1",
                    price: {
                      currency: "eur",
                      product: {
                        id: "prod_auto",
                        name: "Alepha Club",
                        active: false,
                      },
                      tax_behavior: "unspecified",
                      recurring: { interval: "month", interval_count: 1 },
                    },
                  },
                ],
              },
            };
          },
          update: async (id: string, params: unknown) => {
            calls.push({ call: "update", id, params });
            return { id };
          },
        },
        prices: {
          create: async (params: unknown) => {
            calls.push({ call: "prices.create", params });
            return { id: "price_new" };
          },
        },
      };

      await provider.updateSubscriptionPrice("sub_1", 0);

      expect(calls).toEqual([
        {
          call: "retrieve",
          id: "sub_1",
          params: { expand: ["items.data.price.product"] },
        },
        {
          call: "prices.create",
          params: {
            currency: "eur",
            unit_amount: 0,
            recurring: { interval: "month", interval_count: 1 },
            product_data: { name: "Alepha Club" },
          },
        },
        {
          call: "update",
          id: "sub_1",
          params: {
            items: [{ id: "si_1", price: "price_new" }],
            proration_behavior: "none",
          },
        },
      ]);
    });

    it("refuses to change the price of a multi-item subscription", async () => {
      const provider = make();
      (provider as unknown as { stripe: unknown }).stripe = {
        subscriptions: {
          retrieve: async () => ({ items: { data: [{}, {}] } }),
        },
      };

      await expect(
        provider.updateSubscriptionPrice("sub_1", 4900),
      ).rejects.toBeInstanceOf(AlephaError);
    });

    it("schedules, clears, reads and cancels a subscription on the account", async () => {
      const provider = make();
      const calls = provider.recordBilling();
      const account = { stripeAccount: "acct_club" };

      await provider.setSubscriptionCancelAt("sub_1", 1_800_000_000, account);
      await provider.setSubscriptionCancelAt("sub_1", null, account);
      await provider.retrieveSubscription("sub_1", account);
      await provider.cancelSubscription("sub_1", account);
      await provider.cancelSubscription("sub_1", {
        ...account,
        atPeriodEnd: false,
      });

      expect(calls).toEqual([
        {
          call: "update",
          params: { cancel_at: 1_800_000_000, proration_behavior: "none" },
          options: account,
        },
        {
          call: "update",
          params: { cancel_at: "", proration_behavior: "none" },
          options: account,
        },
        { call: "retrieve", params: undefined, options: account },
        {
          call: "update",
          params: { cancel_at_period_end: true },
          options: account,
        },
        { call: "cancel", params: undefined, options: account },
      ]);
    });
  });

  describe("connected accounts", () => {
    it("tags the account with the caller's metadata", async () => {
      const provider = make();
      const created = provider.stubAccounts({ id: "acct_1", metadata: {} });

      await provider.createConnectAccount({
        displayName: "Padel Aix",
        metadata: { clubSlug: "padel-aix" },
      });

      expect(created[0]?.metadata).toEqual({ clubSlug: "padel-aix" });
    });

    it("sends no metadata when none is given", async () => {
      const provider = make();
      const created = provider.stubAccounts({ id: "acct_1", metadata: {} });

      await provider.createConnectAccount({ displayName: "Padel Aix" });

      expect(created[0]).not.toHaveProperty("metadata");
    });

    it("reads the account's metadata back", async () => {
      const provider = make();
      provider.stubAccounts({
        id: "acct_2",
        display_name: "Padel Aix",
        metadata: { clubSlug: "padel-aix" },
      });

      await expect(provider.getConnectAccount("acct_2")).resolves.toEqual({
        id: "acct_2",
        displayName: "Padel Aix",
        metadata: { clubSlug: "padel-aix" },
      });
    });
  });

  describe("retrieveSessionStatus", () => {
    it("asks the connected account a direct charge lives on", async () => {
      const provider = make();
      const calls = provider.stubLookups();

      await expect(
        provider.retrieveSessionStatus("cs_test_1", {
          stripeAccount: "acct_club",
        }),
      ).resolves.toBe("captured");
      await expect(
        provider.retrieveSessionStatus("pi_1", { stripeAccount: "acct_club" }),
      ).resolves.toBe("captured");

      expect(calls).toEqual([
        { id: "cs_test_1", requestOptions: { stripeAccount: "acct_club" } },
        { id: "pi_1", requestOptions: { stripeAccount: "acct_club" } },
      ]);
    });

    it("asks the platform account when no account is given", async () => {
      const provider = make();
      const calls = provider.stubLookups();

      await provider.retrieveSessionStatus("cs_test_1");

      expect(calls).toEqual([{ id: "cs_test_1", requestOptions: undefined }]);
    });
  });
});
