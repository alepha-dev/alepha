import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";
import { AlephaBilling } from "../index.ts";
import { BillingService } from "../services/BillingService.ts";

describe("BillingService", () => {
  it("should create an intent in 'created' status", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres).with(AlephaBilling);
    const billing = alepha.inject(BillingService);
    await alepha.start();

    const intent = await billing.createIntent(1500, "eur");
    expect(intent.amount).toBe(1500);
    expect(intent.currency).toBe("eur");
    expect(intent.status).toBe("created");
  });

  it("should create a session and transition to 'processing'", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres).with(AlephaBilling);
    const billing = alepha.inject(BillingService);
    await alepha.start();

    const intent = await billing.createIntent(1500, "eur");
    const session = await billing.createSession(
      intent.id,
      "https://example.com/return",
    );

    expect(session.url).toContain("/billing/mock-checkout/");
    expect(session.intentId).toBe(intent.id);
  });

  it("should capture an authorized intent", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres).with(AlephaBilling);
    const billing = alepha.inject(BillingService);
    await alepha.start();

    const intent = await billing.createIntent(1500, "eur");
    await billing.createSession(intent.id, "https://example.com", true);
    await billing.handleWebhookEvent(intent.id, "authorized");

    const captured = await billing.capture(intent.id);
    expect(captured.status).toBe("captured");
  });

  it("should void an authorized intent", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres).with(AlephaBilling);
    const billing = alepha.inject(BillingService);
    await alepha.start();

    const intent = await billing.createIntent(1500, "eur");
    await billing.createSession(intent.id, "https://example.com", true);
    await billing.handleWebhookEvent(intent.id, "authorized");

    const voided = await billing.void(intent.id);
    expect(voided.status).toBe("voided");
  });

  it("should refund a captured intent", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres).with(AlephaBilling);
    const billing = alepha.inject(BillingService);
    await alepha.start();

    const intent = await billing.createIntent(1500, "eur");
    await billing.createSession(intent.id, "https://example.com");
    await billing.handleWebhookEvent(intent.id, "captured");

    const refund = await billing.refund(intent.id, 500, "Customer request");
    expect(refund.amount).toBe(500);
    expect(refund.status).toBe("completed");
  });

  it("should record a cash payment directly as captured", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres).with(AlephaBilling);
    const billing = alepha.inject(BillingService);
    await alepha.start();

    const intent = await billing.recordCashPayment(1500, "eur", {
      orderId: "order-1",
    });
    expect(intent.status).toBe("captured");
    expect(intent.metadata).toEqual({ orderId: "order-1" });
  });

  it("should cancel a created intent", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres).with(AlephaBilling);
    const billing = alepha.inject(BillingService);
    await alepha.start();

    const intent = await billing.createIntent(1500, "eur");
    const cancelled = await billing.cancel(intent.id);
    expect(cancelled.status).toBe("cancelled");
  });

  it("should reject capture from wrong status", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres).with(AlephaBilling);
    const billing = alepha.inject(BillingService);
    await alepha.start();

    const intent = await billing.createIntent(1500, "eur");
    await expect(billing.capture(intent.id)).rejects.toThrowError();
  });

  it("should reject refund from wrong status", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres).with(AlephaBilling);
    const billing = alepha.inject(BillingService);
    await alepha.start();

    const intent = await billing.createIntent(1500, "eur");
    await expect(billing.refund(intent.id, 500)).rejects.toThrowError();
  });

  it("should reject void from wrong status", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres).with(AlephaBilling);
    const billing = alepha.inject(BillingService);
    await alepha.start();

    const intent = await billing.createIntent(1500, "eur");
    await expect(billing.void(intent.id)).rejects.toThrowError();
  });

  it("should reject cancel from wrong status", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres).with(AlephaBilling);
    const billing = alepha.inject(BillingService);
    await alepha.start();

    const intent = await billing.createIntent(1500, "eur");
    await billing.createSession(intent.id, "https://example.com");
    await expect(billing.cancel(intent.id)).rejects.toThrowError();
  });
});
