import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { DateTimeProvider } from "alepha/datetime";
import { DatabaseProvider, sql } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { CartService } from "../cart/services/CartService.ts";
import { AlephaCommerceCheckout } from "../checkout/index.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { OrderService } from "../services/OrderService.ts";
import { StockService } from "../services/StockService.ts";

/**
 * Postgres by default. SQLite is the other path `StockService.claim` takes:
 * no lock, every writer queued on one connection, and the replay decides.
 */
const setup = async (backend: "postgres" | "sqlite" = "postgres") => {
  const alepha =
    backend === "postgres"
      ? Alepha.create().with(AlephaOrmPostgres).with(AlephaCommerceCheckout)
      : Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }).with(
          AlephaCommerceCheckout,
        );
  const ctx = {
    alepha,
    catalog: alepha.inject(CatalogService),
    carts: alepha.inject(CartService),
    checkout: alepha.inject(CheckoutService),
    orders: alepha.inject(OrderService),
    stock: alepha.inject(StockService),
    payments: alepha.inject(PaymentService),
    dateTime: alepha.inject(DateTimeProvider),
    db: alepha.inject(DatabaseProvider),
  };
  await alepha.start();
  return ctx;
};

/**
 * How many sessions are queued on the product's stock lock right now.
 *
 * Lets a spec hold one claim open and then wait, without a sleep, until every
 * other racer has either decided or is queued behind it.
 */
const waitingOnStock = async (
  ctx: Awaited<ReturnType<typeof setup>>,
  productId: string,
) => {
  const [row] = await ctx.db.execute(sql`
    SELECT count(*)::int AS waiting FROM pg_locks
    WHERE locktype = 'advisory' AND NOT granted AND objsubid = 2
      AND classid = hashtext(${StockService.LOCK_NAMESPACE})::oid
      AND objid = hashtext(${productId})::oid`);
  return Number(row?.waiting ?? 0);
};

/**
 * Run `claim` inside a transaction that stays open until `commit()` is
 * called - the shape of `OrderService.create`, which reserves and then keeps
 * writing before it commits.
 */
const holdOpen = (
  ctx: Awaited<ReturnType<typeof setup>>,
  claim: () => Promise<unknown>,
) => {
  let commit!: () => void;
  let claimed!: () => void;
  const committing = new Promise<void>((resolve) => {
    commit = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    claimed = resolve;
  });
  const outcome = ctx.db
    .transactional(async () => {
      try {
        await claim();
      } finally {
        claimed();
      }
      await committing;
    })
    .then(
      () => "won" as const,
      () => "lost" as const,
    );
  return { ready, commit, outcome };
};

const aRing = (catalog: CatalogService) =>
  catalog.create({
    slug: `ring-${randomUUID()}`,
    name: "Bague Aurore",
    price: 8900,
    published: true,
    config: { trackStock: true },
  });

/**
 * Take a cart to the payment page, returning the intent to settle or fail.
 */
const reachPaymentWithSession = async (
  ctx: Awaited<ReturnType<typeof setup>>,
  productId: string,
  quantity = 1,
) => {
  const cart = await ctx.carts.resolve(ctx.carts.newToken());
  await ctx.carts.add(cart.id, productId, quantity);
  const opened = await ctx.checkout.start(cart.id);
  const { session, handoff } = await ctx.checkout.pay(opened.id, {
    returnUrl: "https://bijoux.example/merci",
  });
  return { session, handoff, sessionId: opened.id };
};

const reachPayment = reachPaymentWithSession;

describe("stock reservation", () => {
  it("distinguishes on-hand, reserved and available", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 3);

    await reachPayment(ctx, ring.id, 2);

    // Nothing has left the drawer...
    expect(await ctx.stock.onHand(ring.id)).toBe(3);
    // ...but two units are spoken for...
    expect(await ctx.stock.reserved(ring.id)).toBe(2);
    // ...so only one may still be sold.
    expect(await ctx.stock.available(ring.id)).toBe(1);
  });

  it("stops the second buyer from reaching payment for the last one", async ({
    expect,
  }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 1);

    // First buyer holds it.
    await reachPayment(ctx, ring.id, 1);

    // Second buyer is refused at the checkout, not after paying.
    await expect(reachPayment(ctx, ring.id, 1)).rejects.toThrow(
      /Insufficient stock/,
    );
  });

  it("consumes the hold when the payment settles", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 3);

    const { handoff } = await reachPayment(ctx, ring.id, 2);
    await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");

    expect(await ctx.stock.onHand(ring.id)).toBe(1);
    // The hold is gone — it must not be counted twice.
    expect(await ctx.stock.reserved(ring.id)).toBe(0);
    expect(await ctx.stock.available(ring.id)).toBe(1);
  });

  it("gives the stock back the moment the payment fails", async ({
    expect,
  }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 1);

    const { session, handoff } = await reachPayment(ctx, ring.id, 1);
    expect(await ctx.stock.available(ring.id)).toBe(0);

    await ctx.payments.handleWebhookEvent(handoff.intentId, "failed");

    // Released at once, not five minutes later when the sweep runs.
    expect(await ctx.stock.available(ring.id)).toBe(1);
    expect((await ctx.checkout.getById(session.id)).status).toBe("abandoned");
    expect((await ctx.orders.getById(session.orderId!)).status).toBe(
      "cancelled",
    );
  });

  it("expires a hold on its own, before any sweep runs", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 1);

    await reachPayment(ctx, ring.id, 1);
    expect(await ctx.stock.available(ring.id)).toBe(0);

    // Walk past the TTL. Nothing has swept; availability alone must recover.
    await ctx.dateTime.travel(
      StockService.RESERVATION_TTL_MINUTES + 1,
      "minutes",
    );

    expect(await ctx.stock.available(ring.id)).toBe(1);
  });

  it("the sweep marks expired holds released", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 1);

    const { session } = await reachPayment(ctx, ring.id, 1);
    await ctx.dateTime.travel(
      StockService.RESERVATION_TTL_MINUTES + 1,
      "minutes",
    );

    /*
     * Sweep, but do not assert how many *this* call released.
     *
     * `AlephaCommerceCheckout` registers `StockReservationSweeper`, whose `$job`
     * runs the very same method every fifteen minutes. `CronProvider` schedules
     * with `dateTime.wait()`, so the travel above — 31 minutes, two cron
     * boundaries — fires that job rather than waiting out real time. Whether its
     * handler lands before or after the line below is a race decided by machine
     * load: the count was 1 when the spec ran alone and 0 under a loaded
     * `yarn v` or CI, a flake that says nothing about the sweep.
     *
     * What matters is the end state, and that is the same whichever caller got
     * there first.
     */
    await ctx.stock.releaseExpiredReservations();

    const holds = await ctx.stock.reservationsOf(session.orderId!);
    expect(holds.map((h) => h.status)).toEqual(["released"]);

    // Running it again finds nothing — the sweep is idempotent. Deterministic
    // whoever swept first, because by now there is nothing left to release.
    expect(await ctx.stock.releaseExpiredReservations()).toBe(0);
  });

  it("does not hold anything for a kind that consumes nothing", async ({
    expect,
  }) => {
    const ctx = await setup();
    const download = await ctx.catalog.create({
      kind: "digital",
      slug: `pdf-${randomUUID()}`,
      name: "Guide d'entretien",
      price: 500,
      published: true,
      config: { downloadUrl: "https://example.invalid/guide.pdf" },
    });

    const { session } = await reachPayment(ctx, download.id, 1);
    expect(await ctx.stock.reservationsOf(session.orderId!)).toEqual([]);
  });

  it("does not hold anything for an untracked good", async ({ expect }) => {
    const ctx = await setup();
    const madeToOrder = await ctx.catalog.create({
      slug: `custom-${randomUUID()}`,
      name: "Pièce sur mesure",
      price: 45000,
      published: true,
      config: { trackStock: false },
    });

    const { session } = await reachPayment(ctx, madeToOrder.id, 1);
    expect(await ctx.stock.reservationsOf(session.orderId!)).toEqual([]);
  });

  it("a counter sale skips the hold and sells straight away", async ({
    expect,
  }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 2);

    const order = await ctx.orders.create({
      status: "paid",
      lines: [{ productId: ring.id, quantity: 1 }],
    });

    expect(order.status).toBe("paid");
    expect(await ctx.stock.onHand(ring.id)).toBe(1);
    expect(await ctx.stock.reservationsOf(order.id)).toEqual([]);
  });

  it("a redelivered webhook does not decrement twice", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 5);

    const { handoff } = await reachPayment(ctx, ring.id, 1);
    await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");
    await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");
    await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");

    expect(await ctx.stock.onHand(ring.id)).toBe(4);
  });

  /**
   * Concurrency, on the real Postgres provider (and on SQLite, for the three
   * races both of `StockService.claim`'s paths must win).
   *
   * `reserve` and `recordSale` used to read the sum, compare in memory and
   * write. At READ COMMITTED two transactions read the SAME sum before either
   * commits, so both passed the check and both wrote - and there is no counter
   * row to lock, since on-hand is a SUM over an append-only ledger.
   */
  describe("under concurrency", () => {
    /*
     * The same three races on both of `StockService.claim`'s paths: Postgres,
     * where the product lock decides, and SQLite, where the replay does.
     */
    describe.each(["postgres", "sqlite"] as const)("on %s", (backend) => {
      it("lets exactly five of twenty racers reserve the last five units", async ({
        expect,
      }) => {
        const ctx = await setup(backend);
        const ring = await aRing(ctx.catalog);
        await ctx.stock.recordIntake(ring.id, 5);

        const outcomes = await Promise.all(
          Array.from({ length: 20 }, () =>
            ctx.stock
              .reserve(ring.id, 1, { orderId: randomUUID() })
              .then(() => "held" as const)
              .catch(() => "refused" as const),
          ),
        );

        expect(outcomes.filter((it) => it === "held")).toHaveLength(5);
        expect(await ctx.stock.reserved(ring.id)).toBe(5);
        expect(await ctx.stock.available(ring.id)).toBe(0);
      });

      it("never lets concurrent sales take the ledger below zero", async ({
        expect,
      }) => {
        const ctx = await setup(backend);
        const ring = await aRing(ctx.catalog);
        await ctx.stock.recordIntake(ring.id, 3);

        const outcomes = await Promise.all(
          Array.from({ length: 10 }, () =>
            ctx.stock
              .recordSale(ring.id, 1)
              .then(() => "sold" as const)
              .catch(() => "refused" as const),
          ),
        );

        expect(outcomes.filter((it) => it === "sold")).toHaveLength(3);
        expect(await ctx.stock.onHand(ring.id)).toBe(0);
      });

      it("respects multi-unit reservations at the boundary", async ({
        expect,
      }) => {
        const ctx = await setup(backend);
        const ring = await aRing(ctx.catalog);
        await ctx.stock.recordIntake(ring.id, 4);

        // Three racers wanting two each: the ledger backs exactly two of them.
        const outcomes = await Promise.all(
          Array.from({ length: 3 }, () =>
            ctx.stock
              .reserve(ring.id, 2, { orderId: randomUUID() })
              .then(() => "held" as const)
              .catch(() => "refused" as const),
          ),
        );

        expect(outcomes.filter((it) => it === "held")).toHaveLength(2);
        expect(await ctx.stock.reserved(ring.id)).toBe(4);
      });
    });

    /*
     * The two below are the window the three above only hit by luck.
     *
     * A claim's `createdAt` is Postgres' `now()`, the start of the inserting
     * transaction, but the row is only visible from its COMMIT. Ordering the
     * claims by `(createdAt, id)` and keeping the ones that fit let a racer
     * stamped later decide before an earlier claim was visible, and both
     * kept. In CI that window was the gap between INSERT and COMMIT under
     * load; here it is held open on purpose, the way `OrderService.create`
     * holds it open while it writes the rest of the order.
     */
    it("counts a hold whose transaction has not committed yet", async ({
      expect,
    }) => {
      const ctx = await setup();
      const ring = await aRing(ctx.catalog);
      await ctx.stock.recordIntake(ring.id, 4);

      const first = holdOpen(ctx, () =>
        ctx.stock.reserve(ring.id, 2, { orderId: randomUUID() }),
      );
      await first.ready;

      let settled = 0;
      const others = Array.from({ length: 2 }, () =>
        ctx.stock
          .reserve(ring.id, 2, { orderId: randomUUID() })
          .then(
            () => "won" as const,
            () => "lost" as const,
          )
          .finally(() => {
            settled++;
          }),
      );

      // Each racer has either decided without seeing the open hold, or is
      // queued behind it. Only then does the first one commit.
      await expect
        .poll(async () => settled + (await waitingOnStock(ctx, ring.id)))
        .toBe(2);
      first.commit();

      const outcomes = [await first.outcome, ...(await Promise.all(others))];
      expect(outcomes.filter((it) => it === "won")).toHaveLength(2);
      expect(await ctx.stock.reserved(ring.id)).toBe(4);
    });

    it("counts a sale whose transaction has not committed yet", async ({
      expect,
    }) => {
      const ctx = await setup();
      const ring = await aRing(ctx.catalog);
      await ctx.stock.recordIntake(ring.id, 2);

      const first = holdOpen(ctx, () => ctx.stock.recordSale(ring.id, 1));
      await first.ready;

      let settled = 0;
      const others = Array.from({ length: 2 }, () =>
        ctx.stock
          .recordSale(ring.id, 1)
          .then(
            () => "won" as const,
            () => "lost" as const,
          )
          .finally(() => {
            settled++;
          }),
      );

      await expect
        .poll(async () => settled + (await waitingOnStock(ctx, ring.id)))
        .toBe(2);
      first.commit();

      const outcomes = [await first.outcome, ...(await Promise.all(others))];
      expect(outcomes.filter((it) => it === "won")).toHaveLength(2);
      expect(await ctx.stock.onHand(ring.id)).toBe(0);
    });

    /*
     * Each claim holds its product's lock until the order commits, so an
     * order walking its lines in cart order could hold one product while
     * waiting on another that a second order holds while waiting on the
     * first. Postgres breaks that deadlock by failing one of the checkouts.
     */
    it("takes an order's stock locks in one order, so two orders cannot deadlock", async ({
      expect,
    }) => {
      const ctx = await setup();
      const [low, high] = [
        await aRing(ctx.catalog),
        await aRing(ctx.catalog),
      ].sort((a, b) => (a.id < b.id ? -1 : 1));
      await ctx.stock.recordIntake(low!.id, 2);
      await ctx.stock.recordIntake(high!.id, 2);

      // One transaction claims the lower product, and pauses before the
      // higher one.
      let resume!: () => void;
      let claimedLow!: () => void;
      const paused = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const holdingLow = new Promise<void>((resolve) => {
        claimedLow = resolve;
      });
      // A failure reads as the driver's own message ("deadlock detected"),
      // not drizzle's "Failed query" wrapper around it.
      const reason = (error: Error) =>
        (error.cause as Error | undefined)?.message ?? error.message;

      const first = ctx.db
        .transactional(async () => {
          try {
            await ctx.stock.reserve(low!.id, 1, { orderId: randomUUID() });
          } finally {
            claimedLow();
          }
          await paused;
          await ctx.stock.reserve(high!.id, 1, { orderId: randomUUID() });
        })
        .then(() => "won", reason);
      await holdingLow;

      // An order listing the same two products the other way round.
      const second = ctx.orders
        .create({
          status: "pending",
          lines: [
            { productId: high!.id, quantity: 1 },
            { productId: low!.id, quantity: 1 },
          ],
        })
        .then(() => "won", reason);

      // It queues on the lower product. Taking its lines as listed, it would
      // hold the higher one while it waits, and the first could not finish.
      await expect.poll(() => waitingOnStock(ctx, low!.id)).toBe(1);
      resume();

      expect([await first, await second]).toEqual(["won", "won"]);
    });

    /*
     * REPEATABLE READ keeps the snapshot it took before waiting on the lock,
     * so the check reads none of the claims that committed meanwhile: three
     * racers for two units each all kept their holds against four on hand.
     */
    it("refuses a claim under REPEATABLE READ, which the lock cannot protect", async ({
      expect,
    }) => {
      const ctx = await setup();
      const ring = await aRing(ctx.catalog);
      await ctx.stock.recordIntake(ring.id, 1);

      await expect(
        ctx.db.transactional(
          () => ctx.stock.reserve(ring.id, 1, { orderId: randomUUID() }),
          { isolationLevel: "repeatable read" },
        ),
      ).rejects.toThrow(/REPEATABLE READ/);
      expect(await ctx.stock.reserved(ring.id)).toBe(0);
    });
  });

  /**
   * A PSP intent OUTLIVES the checkout session that created it, so a capture
   * can land after the checkout is over. Settling it marked an order paid
   * whose stock had already been released to other buyers: the customer was
   * charged, the order stayed cancelled, and the session flipped to completed.
   */
  describe("a capture that arrives too late", () => {
    it("closes the payment when the checkout is abandoned", async ({
      expect,
    }) => {
      const ctx = await setup();
      const ring = await aRing(ctx.catalog);
      await ctx.stock.recordIntake(ring.id, 2);

      const { sessionId, handoff } = await reachPaymentWithSession(
        ctx,
        ring.id,
        1,
      );
      await ctx.checkout.abandonWithOrder(sessionId);

      // The intent is closed, so the capture cannot happen at all.
      expect((await ctx.payments.getIntent(handoff.intentId)).status).toBe(
        "expired",
      );

      // And a webhook arriving anyway is refused by the transition table.
      await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");

      const session = await ctx.checkout.getById(sessionId);
      expect(session.status).toBe("abandoned");
      expect((await ctx.orders.getById(session.orderId!)).status).toBe(
        "cancelled",
      );
      // The hold is gone, so the unit is back on sale.
      expect(await ctx.stock.available(ring.id)).toBe(2);
    });

    it("records a capture for an order that was cancelled behind the session", async ({
      expect,
    }) => {
      const ctx = await setup();
      const ring = await aRing(ctx.catalog);
      await ctx.stock.recordIntake(ring.id, 2);

      const { sessionId, handoff } = await reachPaymentWithSession(
        ctx,
        ring.id,
        1,
      );
      const session = await ctx.checkout.getById(sessionId);

      // The order is cancelled while the session is still `paying` and the
      // intent still live - an admin cancellation, a support action. The
      // capture that follows is money for something that is no longer for
      // sale.
      await ctx.orders.cancel(session.orderId!);

      const strays: Array<{ orderId: string }> = [];
      ctx.alepha.events.on("commerce:capture:stray", (event) => {
        strays.push(event);
      });

      await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");

      const order = await ctx.orders.getById(session.orderId!);
      // NOT paid: the stock is already back on sale, so settling would sell
      // it twice.
      expect(order.status).toBe("cancelled");
      expect((await ctx.checkout.getById(sessionId)).status).not.toBe(
        "completed",
      );

      // But the customer HAS been charged, so it is recorded and announced.
      expect(order.strayCaptures).toHaveLength(1);
      expect((order.strayCaptures as any[])[0]).toMatchObject({
        paymentIntentId: handoff.intentId,
        orderStatus: "cancelled",
        amount: order.total,
      });
      expect(strays.map((it) => it.orderId)).toEqual([order.id]);
    });
  });
});
