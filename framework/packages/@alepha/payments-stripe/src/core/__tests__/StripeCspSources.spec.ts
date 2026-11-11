import { Alepha } from "alepha";
import { AlephaApiPayments, PaymentProvider } from "alepha/api/payments";
import {
  AlephaServer,
  helmetOptions,
  ServerHelmetProvider,
} from "alepha/server";
import { describe, it } from "vitest";

import { AlephaPaymentsStripe } from "../index.ts";
import { StripePaymentProvider } from "../providers/StripePaymentProvider.ts";

/**
 * Stripe's hosts join the policy when Stripe is the payment provider, and
 * only then (#Q3358). Proven by the header alone: the renderer that loads
 * Stripe.js in the browser has never been run against a real account.
 */
describe("StripePaymentProvider CSP sources", () => {
  const policy = (alepha: Alepha) =>
    alepha.inject(ServerHelmetProvider).getHeaders()[
      "content-security-policy"
    ] ?? "";

  const directive = (value: string, name: string) =>
    value
      .split(";")
      .map((it) => it.trim().split(/\s+/))
      .find(([key]) => key === name)
      ?.slice(1) ?? [];

  const app = (csp: boolean) => {
    const alepha = Alepha.create({
      env: {
        STRIPE_SECRET_KEY: "sk_test_dummy",
        STRIPE_WEBHOOK_SECRET: "whsec_test",
      },
    }).with(AlephaServer);
    if (csp) {
      alepha.store.mut(helmetOptions, (old) => ({
        ...old,
        contentSecurityPolicy: {},
      }));
    }
    return alepha;
  };

  it("adds Stripe.js's script, frame and connect hosts when Stripe is the provider and the CSP is on", ({
    expect,
  }) => {
    const alepha = app(true).with(AlephaPaymentsStripe);
    expect(alepha.inject(PaymentProvider)).toBeInstanceOf(
      StripePaymentProvider,
    );

    const value = policy(alepha);
    for (const [name, sources] of Object.entries(
      StripePaymentProvider.CSP_SOURCES,
    )) {
      expect(directive(value, name)).toEqual(["'self'", ...sources]);
    }
  });

  it("adds no Stripe host with the in-memory provider", ({ expect }) => {
    const alepha = app(true).with(AlephaApiPayments);
    expect(alepha.inject(PaymentProvider)).not.toBeInstanceOf(
      StripePaymentProvider,
    );

    expect(policy(alepha)).not.toContain("stripe.com");
  });

  it("sends nothing while the CSP is off", ({ expect }) => {
    const alepha = app(false).with(AlephaPaymentsStripe);
    alepha.inject(PaymentProvider);

    expect(policy(alepha)).toBe("");
  });
});
