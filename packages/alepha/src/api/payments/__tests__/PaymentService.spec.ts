import { randomUUID } from "node:crypto";
import { Alepha } from "alepha";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";
import { users } from "../../users/entities/users.ts";
import { AdminPaymentController } from "../controllers/AdminPaymentController.ts";
import { PaymentError } from "../errors/PaymentError.ts";
import { AlephaApiPayments } from "../index.ts";
import { MemoryPaymentProvider } from "../providers/MemoryPaymentProvider.ts";
import { PaymentProvider } from "../providers/PaymentProvider.ts";
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

  it("should not over-refund under concurrent refunds", async ({ expect }) => {
    const { payments } = await setup();

    const intent = await payments.recordCashPayment(1000, "eur");

    // Fire many concurrent refunds; at most two of 500 fit in 1000. Any
    // extra winner means the check-then-write raced and money was
    // over-refunded.
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => payments.refund(intent.id, 500)),
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeLessThanOrEqual(2);

    // The money invariant, stated directly: never refund more than was
    // captured. Counting winners is a proxy; this is the thing that matters.
    const refunded = await (payments as any).refundRepo.findMany({
      where: { intentId: { eq: intent.id }, status: { ne: "failed" } },
    });
    const total = refunded.reduce(
      (sum: number, r: { amount: number }) => sum + r.amount,
      0,
    );
    expect(total).toBeLessThanOrEqual(1000);

    const updated = await payments.getIntent(intent.id);
    expect(["partially_refunded", "refunded"]).toContain(updated.status);
  });

  it("should not create two provider sessions for one intent", async ({
    expect,
  }) => {
    // A slow PSP widens the window between the status check and the status
    // write — the realistic shape of the race (PSP calls are network I/O).
    class SlowPaymentProvider extends MemoryPaymentProvider {
      public override async createSession(
        ...args: Parameters<MemoryPaymentProvider["createSession"]>
      ) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return super.createSession(...args);
      }
    }

    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with({ provide: PaymentProvider, use: SlowPaymentProvider })
      .with(AlephaApiPayments);
    const payments = alepha.inject(PaymentService);
    await alepha.start();

    const intent = await payments.createIntent(1500, "eur");

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        payments.createSession(intent.id, "https://example.com/return"),
      ),
    );

    // Only one session may be created: the loser's ref would overwrite the
    // winner's, orphaning the payment made against the first session.
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("should not expire an intent that was captured mid-sweep", async ({
    expect,
  }) => {
    const { payments } = await setup();

    const intent = await payments.createIntent(1500, "eur");
    await payments.createSession(intent.id, "https://example.com");

    // The sweep read the intent while it was still "processing"...
    const staleSnapshot = await payments.getIntent(intent.id);

    // ...then a webhook captured it before the sweep wrote.
    await payments.handleWebhookEvent(intent.id, "captured");

    await payments.expireIntent(staleSnapshot);

    // The captured payment must never be stomped to "expired".
    const updated = await payments.getIntent(intent.id);
    expect(updated.status).toBe("captured");
  });

  it("should refuse mock checkout endpoints in production", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: {
        NODE_ENV: "production",
        APP_SECRET: "prod-secret-for-tests-1234567890",
        DATABASE_URL: "sqlite://:memory:",
        SERVER_PORT: 0,
      },
    }).with(AlephaApiPayments);
    await alepha.start();

    const { ServerProvider } = await import("alepha/server");
    const hostname = alepha.inject(ServerProvider).hostname;

    // The memory provider is active (no PSP configured) — but in production
    // an unauthenticated "mark as paid" endpoint must be refused, not
    // silently exposed.
    const resp = await fetch(
      `${hostname}/payments/mock-checkout/00000000-0000-4000-8000-000000000001/confirm`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );

    expect(resp.status).toBe(403);
    await alepha.stop();
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

  it("embeds the paying-user summary when a users repository is registered", async ({
    expect,
  }) => {
    // Registering a users repository is what flips the best-effort join on
    // (and creates the `users` table) — same mechanism as the files module's
    // uploader join. The other tests in this file run without it and confirm
    // findIntents still works with `user` simply absent.
    class TestUsers {
      repo = $repository(users);
    }

    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with(AlephaApiPayments);
    const testUsers = alepha.inject(TestUsers);
    const payments = alepha.inject(PaymentService);
    const controller = alepha.inject(AdminPaymentController);
    await alepha.start();

    const payerId = randomUUID();
    await testUsers.repo.create({
      id: payerId,
      email: "payer@example.com",
      username: "payer",
    });

    const paid = await payments.createIntent(1500, "eur");
    await payments.createSession(
      paid.id,
      "https://example.com",
      false,
      payerId,
    );
    const anonymous = await payments.createIntent(900, "eur");

    // Through the controller rather than the service, so the response schema
    // is exercised too — a summary the schema fails to declare would vanish
    // silently from the payload.
    const page = await controller.listIntents.run(
      { query: {} },
      { user: { id: randomUUID(), name: "Admin", roles: ["admin"] } },
    );

    // Matched by our own ids — the test database is shared across specs, so
    // absolute counts would race with whatever other tests created.
    const withUser = page.content.find((intent) => intent.id === paid.id);
    const withoutUser = page.content.find(
      (intent) => intent.id === anonymous.id,
    );
    expect(withUser?.user?.email).toBe("payer@example.com");
    // No userId on the row means the left join matches nothing.
    expect(withoutUser).toBeDefined();
    expect(withoutUser?.user).toBeUndefined();
  });
});
