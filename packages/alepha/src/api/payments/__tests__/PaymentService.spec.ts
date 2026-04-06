import { randomUUID } from "node:crypto";
import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";
import { PaymentError } from "../errors/PaymentError.ts";
import { AlephaApiPayments } from "../index.ts";
import { PaymentService } from "../services/PaymentService.ts";

const setup = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaApiPayments);
  const payments = alepha.inject(PaymentService);
  await alepha.start();
  return { alepha, payments };
};

describe("PaymentService", () => {
  it("should create an intent in 'created' status", async ({ expect }) => {
    const { payments } = await setup();

    const intent = await payments.createIntent(1500, "eur");
    expect(intent.amount).toBe(1500);
    expect(intent.currency).toBe("eur");
    expect(intent.status).toBe("created");
  });

  it("should create a session and transition to 'processing'", async ({
    expect,
  }) => {
    const { payments } = await setup();

    const intent = await payments.createIntent(1500, "eur");
    const session = await payments.createSession(
      intent.id,
      "https://example.com/return",
    );

    expect(session.url).toContain("/payments/mock-checkout/");
    expect(session.intentId).toBe(intent.id);
  });

  it("should capture an authorized intent", async ({ expect }) => {
    const { payments } = await setup();

    const intent = await payments.createIntent(1500, "eur");
    await payments.createSession(intent.id, "https://example.com", true);
    await payments.handleWebhookEvent(intent.id, "authorized");

    const captured = await payments.capture(intent.id);
    expect(captured.status).toBe("captured");
  });

  it("should void an authorized intent", async ({ expect }) => {
    const { payments } = await setup();

    const intent = await payments.createIntent(1500, "eur");
    await payments.createSession(intent.id, "https://example.com", true);
    await payments.handleWebhookEvent(intent.id, "authorized");

    const voided = await payments.void(intent.id);
    expect(voided.status).toBe("voided");
  });

  it("should refund a captured intent", async ({ expect }) => {
    const { payments } = await setup();

    const intent = await payments.createIntent(1500, "eur");
    await payments.createSession(intent.id, "https://example.com");
    await payments.handleWebhookEvent(intent.id, "captured");

    const refund = await payments.refund(intent.id, 500, "Customer request");
    expect(refund.amount).toBe(500);
    expect(refund.status).toBe("completed");
  });

  it("should record a cash payment directly as captured", async ({
    expect,
  }) => {
    const { payments } = await setup();

    const intent = await payments.recordCashPayment(1500, "eur", {
      orderId: "order-1",
    });
    expect(intent.status).toBe("captured");
    expect(intent.metadata).toEqual({ orderId: "order-1" });
  });

  it("should cancel a created intent", async ({ expect }) => {
    const { payments } = await setup();

    const intent = await payments.createIntent(1500, "eur");
    const cancelled = await payments.cancel(intent.id);
    expect(cancelled.status).toBe("cancelled");
  });

  it("should reject capture from wrong status", async ({ expect }) => {
    const { payments } = await setup();

    const intent = await payments.createIntent(1500, "eur");
    await expect(payments.capture(intent.id)).rejects.toThrowError();
  });

  it("should reject refund from wrong status", async ({ expect }) => {
    const { payments } = await setup();

    const intent = await payments.createIntent(1500, "eur");
    await expect(payments.refund(intent.id, 500)).rejects.toThrowError();
  });

  it("should reject void from wrong status", async ({ expect }) => {
    const { payments } = await setup();

    const intent = await payments.createIntent(1500, "eur");
    await expect(payments.void(intent.id)).rejects.toThrowError();
  });

  it("should reject cancel from wrong status", async ({ expect }) => {
    const { payments } = await setup();

    const intent = await payments.createIntent(1500, "eur");
    await payments.createSession(intent.id, "https://example.com");
    await expect(payments.cancel(intent.id)).rejects.toThrowError();
  });

  it("should reject capture amount exceeding authorized amount", async ({
    expect,
  }) => {
    const { payments } = await setup();

    const intent = await payments.createIntent(1500, "eur");
    await payments.createSession(intent.id, "https://example.com", true);
    await payments.handleWebhookEvent(intent.id, "authorized");

    await expect(payments.capture(intent.id, 5000)).rejects.toThrowError(
      PaymentError,
    );
  });

  it("should reject refund exceeding captured amount", async ({ expect }) => {
    const { payments } = await setup();

    const intent = await payments.createIntent(1500, "eur");
    await payments.createSession(intent.id, "https://example.com");
    await payments.handleWebhookEvent(intent.id, "captured");

    await expect(payments.refund(intent.id, 5000)).rejects.toThrowError(
      PaymentError,
    );
  });

  it("should allow multiple partial refunds up to captured amount", async ({
    expect,
  }) => {
    const { payments } = await setup();

    const intent = await payments.createIntent(1500, "eur");
    await payments.createSession(intent.id, "https://example.com");
    await payments.handleWebhookEvent(intent.id, "captured");

    await payments.refund(intent.id, 500);
    const after1 = await payments.getIntent(intent.id);
    expect(after1.status).toBe("partially_refunded");

    await payments.refund(intent.id, 500);
    const after2 = await payments.getIntent(intent.id);
    expect(after2.status).toBe("partially_refunded");

    await payments.refund(intent.id, 500);
    const after3 = await payments.getIntent(intent.id);
    expect(after3.status).toBe("refunded");
  });

  it("should reject refund that would exceed remaining amount", async ({
    expect,
  }) => {
    const { payments } = await setup();

    const intent = await payments.createIntent(1500, "eur");
    await payments.createSession(intent.id, "https://example.com");
    await payments.handleWebhookEvent(intent.id, "captured");

    await payments.refund(intent.id, 1000);

    await expect(payments.refund(intent.id, 1000)).rejects.toThrowError(
      PaymentError,
    );
  });

  it("should ignore webhook that would downgrade status", async ({
    expect,
  }) => {
    const { payments } = await setup();

    const intent = await payments.createIntent(1500, "eur");
    await payments.createSession(intent.id, "https://example.com");
    await payments.handleWebhookEvent(intent.id, "captured");

    await payments.handleWebhookEvent(intent.id, "authorized");

    const current = await payments.getIntent(intent.id);
    expect(current.status).toBe("captured");
  });

  it("should ignore duplicate webhook for same status", async ({ expect }) => {
    const { payments } = await setup();

    const intent = await payments.createIntent(1500, "eur");
    await payments.createSession(intent.id, "https://example.com", true);
    await payments.handleWebhookEvent(intent.id, "authorized");

    await payments.handleWebhookEvent(intent.id, "authorized");

    const current = await payments.getIntent(intent.id);
    expect(current.status).toBe("authorized");
  });

  it("should normalize currency to lowercase", async ({ expect }) => {
    const { payments } = await setup();

    const intent = await payments.createIntent(1500, "EUR");
    expect(intent.currency).toBe("eur");
  });

  it("should emit payments:cancelled event on cancel", async ({ expect }) => {
    const { alepha, payments } = await setup();

    const intent = await payments.createIntent(1500, "eur");

    let emitted: unknown = null;
    alepha.events.on("payments:cancelled", (payload: unknown) => {
      emitted = payload;
    });

    await payments.cancel(intent.id);

    expect(emitted).toEqual({
      intentId: intent.id,
      amount: 1500,
      currency: "eur",
      metadata: intent.metadata,
    });
  });

  it("should reject checkout for intent belonging to another user", async ({
    expect,
  }) => {
    const { payments } = await setup();

    const userA = randomUUID();
    const userB = randomUUID();
    const intent = await payments.createIntent(1500, "eur", undefined, {
      userId: userA,
    });

    await expect(
      payments.createSession(intent.id, "https://example.com", false, userB),
    ).rejects.toThrowError(PaymentError);
  });

  it("should set userId on intent during checkout if not already set", async ({
    expect,
  }) => {
    const { payments } = await setup();

    const userX = randomUUID();
    const intent = await payments.createIntent(1500, "eur");

    await payments.createSession(
      intent.id,
      "https://example.com",
      false,
      userX,
    );

    const updated = await payments.getIntent(intent.id);
    expect(updated.userId).toBe(userX);
  });
});
