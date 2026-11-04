import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { AlephaCacheDatabase } from "alepha/cache/database";
import { describe, it } from "vitest";

import { AlephaApiPayments } from "../index.ts";
import { DatabaseMemoryPaymentProvider } from "../providers/DatabaseMemoryPaymentProvider.ts";
import { PaymentProvider } from "../providers/PaymentProvider.ts";

/**
 * Two provider instances on one database stand in for two Worker isolates:
 * what the first one wrote must be there for the second, which shares no
 * memory with it.
 */
describe("DatabaseMemoryPaymentProvider", () => {
  const boot = async () => {
    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:" },
    })
      .with({ provide: PaymentProvider, use: DatabaseMemoryPaymentProvider })
      .with(AlephaCacheDatabase)
      .with(AlephaApiPayments);
    await alepha.start();
    const first = alepha.inject(PaymentProvider);
    const second = alepha.inject(DatabaseMemoryPaymentProvider, {
      lifetime: "transient",
    });
    if (!(first instanceof DatabaseMemoryPaymentProvider) || first === second)
      throw new Error("Expected two database mocks");
    return { first, second };
  };

  it("keeps a card saved at checkout for another instance", async ({
    expect,
  }) => {
    const userId = randomUUID();
    const { first, second } = await boot();

    const session = await first.createSession(
      { id: randomUUID(), userId, amount: 3200 } as never,
      { returnUrl: "/done", saveCard: true, stripeAccount: "acct_x" },
    );
    expect(
      await second.retrieveSavedPaymentMethod(userId, session.providerRef, {
        stripeAccount: "acct_x",
      }),
    ).toBeNull();

    await second.capturePayment(session.providerRef, 3200);
    const card = await first.retrieveSavedPaymentMethod(
      userId,
      session.providerRef,
      { stripeAccount: "acct_x" },
    );
    expect(card?.last4).toBe("4242");

    const charge = await second.chargeOffSession(
      userId,
      card!.providerRef,
      1500,
      { stripeAccount: "acct_x", idempotencyKey: "no-show" },
    );
    expect(charge.status).toBe("succeeded");
    expect(
      await first.chargeOffSession(userId, card!.providerRef, 1500, {
        stripeAccount: "acct_x",
        idempotencyKey: "no-show",
      }),
    ).toEqual(charge);
  });

  it("replays a refund and forgets a deleted card across instances", async ({
    expect,
  }) => {
    const userId = randomUUID();
    const { first, second } = await boot();

    const refund = await first.refundPayment("mem_pi_x", 500, {
      idempotencyKey: "r1",
    });
    expect(
      await second.refundPayment("mem_pi_x", 500, { idempotencyKey: "r1" }),
    ).toEqual(refund);

    const setup = await first.createSetupSession(userId, {
      returnUrl: "/done",
    });
    await second.completeSetupSession(setup.providerRef);
    const card = await first.retrieveSavedPaymentMethod(
      userId,
      setup.providerRef,
    );
    expect(card).not.toBeNull();
    await second.deletePaymentMethod(card!.providerRef);
    expect(
      await first.retrieveSavedPaymentMethod(userId, setup.providerRef),
    ).toBeNull();
  });
});
