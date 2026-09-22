import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { DateTimeProvider } from "alepha/datetime";
import { DatabaseProvider } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { CartService } from "../cart/services/CartService.ts";
import { AlephaCommerceCheckout } from "../checkout/index.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { ProductKindRegistry } from "../providers/ProductKindRegistry.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { OrderService } from "../services/OrderService.ts";
import { ResourceService } from "../services/ResourceService.ts";
import { StockService } from "../services/StockService.ts";
import { TestCourtKind } from "./fixtures/TestCourtKind.ts";

const setup = async (backend: "postgres" | "sqlite") => {
  const alepha =
    backend === "postgres"
      ? Alepha.create().with(AlephaOrmPostgres).with(AlephaCommerceCheckout)
      : Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }).with(
          AlephaCommerceCheckout,
        );
  alepha.inject(ProductKindRegistry).add(alepha.inject(TestCourtKind));
  const ctx = {
    alepha,
    carts: alepha.inject(CartService),
    catalog: alepha.inject(CatalogService),
    checkout: alepha.inject(CheckoutService),
    orders: alepha.inject(OrderService),
    payments: alepha.inject(PaymentService),
    resources: alepha.inject(ResourceService),
    dateTime: alepha.inject(DateTimeProvider),
    db: alepha.inject(DatabaseProvider),
  };
  await alepha.start();
  return ctx;
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const at = (hhmm: string) => `2030-01-05T${hhmm}:00.000Z`;

const line = (resourceIds: string[]) => ({
  resourceIds,
  startsAt: at("18:00"),
  endsAt: at("19:30"),
});

const aClub = async (ctx: Ctx) => {
  const courts = [`court-${randomUUID()}`, `court-${randomUUID()}`];
  const product = await ctx.catalog.create({
    kind: "test-court",
    slug: `padel-${randomUUID()}`,
    name: "Padel, 90 minutes",
    price: 3000,
    published: true,
    config: { courts },
  });
  return { product, courts: courts as [string, string] };
};

const payFor = async (ctx: Ctx, productId: string, court: string) => {
  const cart = await ctx.carts.resolve(ctx.carts.newToken());
  await ctx.carts.add(cart.id, productId, 1, line([court]));
  const opened = await ctx.checkout.start(cart.id);
  const paid = await ctx.checkout.pay(opened.id, {
    returnUrl: "https://club.example/merci",
  });
  return { ...paid, orderId: paid.session.orderId!, sessionId: opened.id };
};

/**
 * Whether the court is free again over the booked slot.
 */
const isFree = async (ctx: Ctx, court: string) =>
  (
    await ctx.resources.availability(
      [{ resourceId: court, capacity: 1 }],
      line([]),
    )
  ).get(court)!.length === 1;

const statuses = async (ctx: Ctx, orderId: string) =>
  (await ctx.resources.claimsOf(orderId)).map((it) => it.status);

describe("releasing intervals", () => {
  describe.each(["postgres", "sqlite"] as const)("on %s", (backend) => {
    it("gives the court back when a pending order is cancelled", async ({
      expect,
    }) => {
      const ctx = await setup(backend);
      const { product, courts } = await aClub(ctx);
      const { orderId } = await payFor(ctx, product.id, courts[0]);
      expect(await isFree(ctx, courts[0])).toBe(false);

      await ctx.orders.cancel(orderId);

      expect(await statuses(ctx, orderId)).toEqual(["released"]);
      expect(await isFree(ctx, courts[0])).toBe(true);
    });

    it("gives the court back the moment the payment fails", async ({
      expect,
    }) => {
      const ctx = await setup(backend);
      const { product, courts } = await aClub(ctx);
      const { handoff, orderId } = await payFor(ctx, product.id, courts[0]);

      await ctx.payments.handleWebhookEvent(handoff.intentId, "failed");

      expect(await statuses(ctx, orderId)).toEqual(["released"]);
      expect(await isFree(ctx, courts[0])).toBe(true);
    });

    it("gives a sold court back on a full refund, once", async ({ expect }) => {
      const ctx = await setup(backend);
      const { product, courts } = await aClub(ctx);
      const { handoff, orderId } = await payFor(ctx, product.id, courts[0]);
      await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");
      expect(await statuses(ctx, orderId)).toEqual(["consumed"]);

      await ctx.orders.refund(orderId);
      // A redelivered refund finds the order refunded and does nothing.
      await ctx.orders.refund(orderId);

      expect(await statuses(ctx, orderId)).toEqual(["released"]);
      expect(await isFree(ctx, courts[0])).toBe(true);
    });

    it("keeps a court booked through a partial refund", async ({ expect }) => {
      const ctx = await setup(backend);
      const { product, courts } = await aClub(ctx);
      const { handoff, orderId } = await payFor(ctx, product.id, courts[0]);
      await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");

      // A goodwill gesture: the customer still plays.
      await ctx.orders.refund(orderId, { refundedTotal: 500 });

      expect((await ctx.orders.getById(orderId)).status).toBe(
        "partially_refunded",
      );
      expect(await statuses(ctx, orderId)).toEqual(["consumed"]);
      expect(await isFree(ctx, courts[0])).toBe(false);
    });
  });

  it("leaves alone a hold the sweep already released", async ({ expect }) => {
    const ctx = await setup("sqlite");
    const { product, courts } = await aClub(ctx);
    // Straight to the order, with no checkout around it: the checkout's own
    // jobs would abandon it during the travel below.
    const { id: orderId } = await ctx.orders.create({
      lines: [
        { productId: product.id, quantity: 1, lineConfig: line([courts[0]]) },
      ],
    });

    await ctx.dateTime.travel(
      StockService.RESERVATION_TTL_MINUTES + 1,
      "minutes",
    );
    await ctx.resources.releaseExpiredReservations();
    const [swept] = await ctx.resources.claimsOf(orderId);

    await ctx.orders.cancel(orderId);

    const [after] = await ctx.resources.claimsOf(orderId);
    expect(after).toMatchObject({ status: "released" });
    expect(after!.updatedAt).toBe(swept!.updatedAt);
  });

  /*
   * D1 runs `transactional()` in place: nothing rolls back the claims earlier
   * lines took when a later one loses, so the order must give them back
   * itself. Simulated on SQLite by switching its transactions off, the flag
   * and the method both: its provider runs its own BEGIN/ROLLBACK. Two lines
   * for the same court and slot: whichever runs first holds it, and the
   * other loses, whatever order the lines come back in.
   */
  it("gives back what earlier lines held when a later one loses, with no transaction", async ({
    expect,
  }) => {
    const ctx = await setup("sqlite");
    Object.defineProperty(ctx.db, "supportsTransactions", { get: () => false });
    Object.defineProperty(ctx.db, "transactional", {
      value: <R>(fn: () => Promise<R>) => fn(),
    });
    const { product, courts } = await aClub(ctx);
    const booking = {
      productId: product.id,
      quantity: 1,
      lineConfig: line([courts[0]]),
    };

    await expect(
      ctx.orders.create({ lines: [booking, booking] }),
    ).rejects.toThrow(/no room/);

    expect(await isFree(ctx, courts[0])).toBe(true);
  });
});
