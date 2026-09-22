import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { CartService } from "../cart/services/CartService.ts";
import { AlephaCommerceCheckout } from "../checkout/index.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { resourceReservations } from "../entities/resourceReservations.ts";
import { ProductKindRegistry } from "../providers/ProductKindRegistry.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { OrderService } from "../services/OrderService.ts";
import { ResourceService } from "../services/ResourceService.ts";
import { StockService } from "../services/StockService.ts";
import { TestCourtKind } from "./fixtures/TestCourtKind.ts";

/**
 * Reaches the ledger directly, to age a hold past its expiry without
 * travelling the clock: travelling would also fire the checkout's own jobs,
 * which abandon the session and close its intent before any capture.
 */
class Ledger {
  public readonly claims = $repository(resourceReservations);
}

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
    stock: alepha.inject(StockService),
    ledger: alepha.inject(Ledger),
  };
  await alepha.start();
  return ctx;
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const slot = (court: string) => ({
  resourceIds: [court],
  startsAt: "2030-01-05T18:00:00.000Z",
  endsAt: "2030-01-05T19:30:00.000Z",
});

const aClub = async (ctx: Ctx) => {
  const court = `court-${randomUUID()}`;
  const padel = await ctx.catalog.create({
    kind: "test-court",
    slug: `padel-${randomUUID()}`,
    name: "Padel, 90 minutes",
    price: 3000,
    published: true,
    config: { courts: [court] },
  });
  const balls = await ctx.catalog.create({
    slug: `balls-${randomUUID()}`,
    name: "Balles de padel",
    price: 900,
    published: true,
    config: { trackStock: true },
  });
  await ctx.stock.recordIntake(balls.id, 5);
  return { padel, balls, court };
};

/**
 * A cart of a court slot and a tube of balls, taken to the payment page.
 */
const reachPayment = async (
  ctx: Ctx,
  club: Awaited<ReturnType<typeof aClub>>,
) => {
  const cart = await ctx.carts.resolve(ctx.carts.newToken());
  await ctx.carts.add(cart.id, club.padel.id, 1, slot(club.court));
  await ctx.carts.add(cart.id, club.balls.id, 1);
  const opened = await ctx.checkout.start(cart.id);
  const { session, handoff } = await ctx.checkout.pay(opened.id, {
    returnUrl: "https://club.example/merci",
  });
  return { sessionId: opened.id, orderId: session.orderId!, handoff };
};

/**
 * The hold outlived its thirty minutes and the sweep has not reached it yet:
 * the order is still `pending`, and nothing holds the court any more.
 */
const expireHolds = async (ctx: Ctx, orderId: string) => {
  for (const claim of await ctx.resources.claimsOf(orderId)) {
    await ctx.ledger.claims.updateById(claim.id, {
      expiresAt: "2020-01-01T00:00:00.000Z",
    });
  }
};

describe("a capture that lands after its hold expired", () => {
  describe.each(["postgres", "sqlite"] as const)("on %s", (backend) => {
    it("becomes a stray capture when somebody else took the slot", async ({
      expect,
    }) => {
      const ctx = await setup(backend);
      const club = await aClub(ctx);
      const late = await reachPayment(ctx, club);
      await expireHolds(ctx, late.orderId);

      const winner = await reachPayment(ctx, club);

      const strays: string[] = [];
      ctx.alepha.events.on("commerce:capture:stray", (event) => {
        strays.push(event.orderId);
      });

      // The webhook is handled: no throw, so no re-delivery loop.
      await ctx.payments.handleWebhookEvent(late.handoff.intentId, "captured");

      const order = await ctx.orders.getById(late.orderId);
      expect(order.status).toBe("cancelled");
      expect(order.strayCaptures).toHaveLength(1);
      expect(strays).toEqual([late.orderId]);
      expect((await ctx.checkout.getById(late.sessionId)).status).not.toBe(
        "completed",
      );

      // Nothing of the failed settlement stayed: no ball sold, no claim.
      expect(await ctx.stock.onHand(club.balls.id)).toBe(5);
      expect(
        (await ctx.resources.claimsOf(late.orderId)).map((it) => it.status),
      ).toEqual(["released"]);

      // The winner keeps the court.
      expect(
        (await ctx.resources.claimsOf(winner.orderId)).map((it) => it.status),
      ).toEqual(["held"]);

      // A re-delivered capture takes the stray path directly.
      await ctx.checkout.settle(late.sessionId, {
        paymentIntentId: late.handoff.intentId,
      });
      expect((await ctx.orders.getById(late.orderId)).status).toBe("cancelled");
    });

    it("sells the slot when nobody took it meanwhile", async ({ expect }) => {
      const ctx = await setup(backend);
      const club = await aClub(ctx);
      const late = await reachPayment(ctx, club);
      await expireHolds(ctx, late.orderId);

      await ctx.payments.handleWebhookEvent(late.handoff.intentId, "captured");

      expect((await ctx.orders.getById(late.orderId)).status).toBe("paid");
      // The dead hold is tidied, and a fresh claim is the sale.
      expect(
        (await ctx.resources.claimsOf(late.orderId)).map((it) => it.status),
      ).toEqual(["released", "consumed"]);
      expect(await ctx.stock.onHand(club.balls.id)).toBe(4);
    });
  });
});
