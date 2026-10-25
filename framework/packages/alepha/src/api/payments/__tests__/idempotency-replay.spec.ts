import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, expect, it } from "vitest";

import { AlephaApiPayments } from "../index.ts";
import { MemoryPaymentProvider } from "../providers/MemoryPaymentProvider.ts";
import { PaymentProvider } from "../providers/PaymentProvider.ts";
import { PaymentService } from "../services/PaymentService.ts";

/**
 * Money moves at most once: a retried request with the same idempotency key
 * gets the first answer back, and a webhook the PSP delivers twice is applied
 * once. Against `MemoryPaymentProvider`, which keys idempotency the way
 * Stripe does: per account.
 */
const setup = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaApiPayments);
  const payments = alepha.inject(PaymentService);
  const provider = alepha.inject(PaymentProvider) as MemoryPaymentProvider;
  await alepha.start();

  const captured: string[] = [];
  const failed: string[] = [];
  alepha.events.on("payments:captured", ({ intentId }) => {
    captured.push(intentId);
  });
  alepha.events.on("payments:failed", ({ intentId }) => {
    failed.push(intentId);
  });

  return { payments, provider, captured, failed };
};

describe("payments idempotency", () => {
  it("answers a retried session with the same key from the first call", async () => {
    const { payments, provider } = await setup();
    const intent = await payments.createIntent(1500, "eur");

    const options = { returnUrl: "https://example.com", idempotencyKey: "k1" };
    const first = await provider.createSession(intent, options);
    const retried = await provider.createSession(intent, options);

    expect(retried.providerRef).toBe(first.providerRef);
  });

  it("scopes an idempotency key to its account", async () => {
    const { payments, provider } = await setup();
    const intent = await payments.createIntent(1500, "eur");

    const platform = await provider.createSession(intent, {
      returnUrl: "https://example.com",
      idempotencyKey: "k1",
    });
    const connected = await provider.createSession(intent, {
      returnUrl: "https://example.com",
      idempotencyKey: "k1",
      stripeAccount: "acct_1",
    });

    expect(connected.providerRef).not.toBe(platform.providerRef);
  });

  it("charges a saved card once for a retried off-session charge", async () => {
    const { provider } = await setup();
    const method = await provider.createPaymentMethod("user-1", "4242", {});

    const first = await provider.chargeOffSession(
      "user-1",
      method.providerRef,
      1500,
      { idempotencyKey: "order-42" },
    );
    const retried = await provider.chargeOffSession(
      "user-1",
      method.providerRef,
      1500,
      { idempotencyKey: "order-42" },
    );
    const another = await provider.chargeOffSession(
      "user-1",
      method.providerRef,
      1500,
      { idempotencyKey: "order-43" },
    );

    expect(first.status).toBe("succeeded");
    expect(retried.providerRef).toBe(first.providerRef);
    expect(another.providerRef).not.toBe(first.providerRef);
  });

  it("never opens a second session for an intent already in flight, key or not", async () => {
    const { payments } = await setup();
    const intent = await payments.createIntent(1500, "eur");

    await payments.createSession(
      intent.id,
      "https://example.com",
      false,
      undefined,
      {
        idempotencyKey: "k1",
      },
    );

    await expect(
      payments.createSession(
        intent.id,
        "https://example.com",
        false,
        undefined,
        {
          idempotencyKey: "k1",
        },
      ),
    ).rejects.toThrow();
  });
});

describe("payments webhook replay", () => {
  it("applies a capture delivered twice once", async () => {
    const { payments, captured } = await setup();
    const intent = await payments.createIntent(1500, "eur");
    await payments.createSession(intent.id, "https://example.com");
    const { providerRef } = await payments.getIntent(intent.id);

    const event = { providerRef: providerRef!, status: "captured", raw: {} };
    await payments.handleParsedWebhook(event);
    await payments.handleParsedWebhook(event);

    expect((await payments.getIntent(intent.id)).status).toBe("captured");
    expect(captured).toEqual([intent.id]);
  });

  it("does not let a replayed failure undo a capture", async () => {
    const { payments, captured, failed } = await setup();
    const intent = await payments.createIntent(1500, "eur");
    await payments.createSession(intent.id, "https://example.com");
    const { providerRef } = await payments.getIntent(intent.id);

    await payments.handleParsedWebhook({
      providerRef: providerRef!,
      status: "captured",
      raw: {},
    });
    await payments.handleParsedWebhook({
      providerRef: providerRef!,
      status: "failed",
      raw: {},
    });

    expect((await payments.getIntent(intent.id)).status).toBe("captured");
    expect(captured).toEqual([intent.id]);
    expect(failed).toEqual([]);
  });

  it("ignores a webhook for a reference no intent holds", async () => {
    const { payments, captured } = await setup();

    await payments.handleParsedWebhook({
      providerRef: "mem_session_unknown",
      status: "captured",
      raw: {},
    });

    expect(captured).toEqual([]);
  });
});
