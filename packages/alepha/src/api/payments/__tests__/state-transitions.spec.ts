import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, expect, it } from "vitest";
import type { PaymentIntentEntity } from "../entities/paymentIntents.ts";
import { AlephaApiPayments } from "../index.ts";
import { PaymentService } from "../services/PaymentService.ts";

/**
 * `capture`, `void` and `cancel` read the intent, assert its status, then wrote
 * with an unguarded `updateById`. Whatever the row said by the time the write
 * landed was overwritten — the assertion only ever described the *snapshot*.
 *
 * The race needs the row to change between the read and the write, which a
 * plain `Promise.all` cannot force here (the shared test connection serialises
 * the statements). `StaleReadPaymentService` reproduces it deterministically:
 * it hands the operation a snapshot that was true a moment ago and is not true
 * any more — exactly the state a second worker leaves behind.
 */
class StaleReadPaymentService extends PaymentService {
  public staleSnapshot?: PaymentIntentEntity;

  public override async getIntent(id: string): Promise<PaymentIntentEntity> {
    const fresh = await super.getIntent(id);
    return this.staleSnapshot ?? fresh;
  }

  /** Read the row as it really is, bypassing the staleness. */
  public actual(id: string): Promise<PaymentIntentEntity> {
    return super.getIntent(id);
  }
}

const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with({ provide: PaymentService, use: StaleReadPaymentService })
    .with(AlephaOrmPostgres)
    .with(AlephaApiPayments);
  const payments = alepha.inject(PaymentService) as StaleReadPaymentService;
  await alepha.start();
  return { alepha, payments };
};

const authorizedIntent = async (payments: StaleReadPaymentService) => {
  const intent = await payments.createIntent(1500, "eur");
  await payments.createSession(intent.id, "https://example.com", true);
  await payments.handleWebhookEvent(intent.id, "authorized");
  return await payments.actual(intent.id);
};

describe("payment state transitions are guarded", () => {
  it("refuses to capture when the row was voided after the read", async () => {
    const { alepha, payments } = await setup();
    const snapshot = await authorizedIntent(payments);

    // Someone else voids it. Our in-flight capture still holds the
    // "authorized" snapshot it read a moment ago.
    await payments.void(snapshot.id);
    payments.staleSnapshot = snapshot;

    await expect(payments.capture(snapshot.id)).rejects.toThrow();

    payments.staleSnapshot = undefined;
    expect((await payments.actual(snapshot.id)).status).toBe("voided");

    await alepha.stop();
  });

  it("refuses to void when the row was captured after the read", async () => {
    const { alepha, payments } = await setup();
    const snapshot = await authorizedIntent(payments);

    await payments.capture(snapshot.id);
    payments.staleSnapshot = snapshot;

    await expect(payments.void(snapshot.id)).rejects.toThrow();

    payments.staleSnapshot = undefined;
    expect((await payments.actual(snapshot.id)).status).toBe("captured");

    await alepha.stop();
  });

  it("refuses to cancel when the row already moved on", async () => {
    const { alepha, payments } = await setup();
    const intent = await payments.createIntent(1500, "eur");
    const snapshot = await payments.actual(intent.id);

    await payments.createSession(intent.id, "https://example.com", true);
    payments.staleSnapshot = snapshot;

    await expect(payments.cancel(intent.id)).rejects.toThrow();

    payments.staleSnapshot = undefined;
    expect((await payments.actual(intent.id)).status).not.toBe("cancelled");

    await alepha.stop();
  });

  it("still captures, voids and cancels normally", async () => {
    const { alepha, payments } = await setup();

    const a = await authorizedIntent(payments);
    expect((await payments.capture(a.id)).status).toBe("captured");

    const b = await authorizedIntent(payments);
    expect((await payments.void(b.id)).status).toBe("voided");

    const c = await payments.createIntent(500, "eur");
    expect((await payments.cancel(c.id)).status).toBe("cancelled");

    await alepha.stop();
  });
});
