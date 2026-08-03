import { randomUUID } from "node:crypto";
import { Alepha } from "alepha";
import {
  MemoryPaymentProvider,
  PaymentProvider,
  PaymentService,
} from "alepha/api/payments";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";
import { CartService } from "../cart/services/CartService.ts";
import { AlephaCommerceCheckout } from "../checkout/index.ts";
import { CheckoutPaymentProvider } from "../checkout/providers/CheckoutPaymentProvider.ts";
import { EmbeddedCheckoutPayment } from "../checkout/providers/EmbeddedCheckoutPayment.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { OrderService } from "../services/OrderService.ts";
import { StockService } from "../services/StockService.ts";

/**
 * A provider with no embedded card field — the Mollie-shaped case, and the one
 * the capability declaration exists for.
 */
class RedirectOnlyProvider extends MemoryPaymentProvider {
  /**
   * Shadow the inherited method with an own property that is not a function —
   * which is exactly what `supportsEmbeddedPayment()` inspects. `as never` is
   * assignable to the base signature, so this stays type-safe.
   */
  override createElementSession = undefined as never;
}

const setup = async (embedded = true) => {
  const alepha = Alepha.create().with(AlephaOrmPostgres);
  if (embedded) {
    alepha.with({
      provide: CheckoutPaymentProvider,
      use: EmbeddedCheckoutPayment,
    });
  }
  alepha.with(AlephaCommerceCheckout);

  const ctx = {
    alepha,
    catalog: alepha.inject(CatalogService),
    carts: alepha.inject(CartService),
    checkout: alepha.inject(CheckoutService),
    orders: alepha.inject(OrderService),
    stock: alepha.inject(StockService),
    payments: alepha.inject(PaymentService),
  };
  await alepha.start();
  return ctx;
};

const aRing = (catalog: CatalogService) =>
  catalog.create({
    slug: `ring-${randomUUID()}`,
    name: "Bague Aurore",
    price: 8900,
    published: true,
    config: { trackStock: true },
  });

const reachPayment = async (ctx: Awaited<ReturnType<typeof setup>>) => {
  const ring = await aRing(ctx.catalog);
  await ctx.stock.recordIntake(ring.id, 3);
  const cart = await ctx.carts.resolve(ctx.carts.newToken());
  await ctx.carts.add(cart.id, ring.id, 1);
  const opened = await ctx.checkout.start(cart.id);
  const result = await ctx.checkout.pay(opened.id, {
    returnUrl: "https://bijoux.example/merci",
  });
  return { ring, ...result };
};

describe("embedded payment", () => {
  it("declares itself as embedded, not redirect", async ({ expect }) => {
    const ctx = await setup();
    expect(ctx.checkout.capabilities()).toEqual({
      modes: ["embedded"],
      collectsShippingAddress: false,
      computesTax: false,
    });
  });

  it("hands the browser a client secret instead of a URL", async ({
    expect,
  }) => {
    const ctx = await setup();
    const { handoff } = await reachPayment(ctx);

    expect(handoff.mode).toBe("embedded");
    if (handoff.mode !== "embedded") throw new Error("unreachable");

    expect(handoff.clientSecret).toContain("_secret_");
    expect(handoff.publishableKey).toBe("pk_memory");
    // The name the front-end dispatches on.
    expect(handoff.provider).toBe("memory");
    expect(handoff.intentId).toBeTruthy();
  });

  it("still creates the order before the payment, and holds stock", async ({
    expect,
  }) => {
    const ctx = await setup();
    const { ring, session } = await reachPayment(ctx);

    // The order exists and is pending — the browser has not confirmed anything.
    const order = await ctx.orders.getById(session.orderId!);
    expect(order.status).toBe("pending");
    // And the unit is held, exactly as in the redirect flow.
    expect(await ctx.stock.reserved(ring.id)).toBe(1);
    expect(await ctx.stock.onHand(ring.id)).toBe(3);
  });

  it("settles from the webhook, not from the browser", async ({ expect }) => {
    const ctx = await setup();
    const { ring, session, handoff } = await reachPayment(ctx);

    // Whatever the browser reports, nothing is settled until the PSP says so.
    expect((await ctx.checkout.getById(session.id)).status).toBe("paying");

    await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");

    expect((await ctx.checkout.getById(session.id)).status).toBe("completed");
    expect((await ctx.orders.getById(session.orderId!)).status).toBe("paid");
    expect(await ctx.stock.onHand(ring.id)).toBe(2);
  });

  it("releases the hold when an embedded payment fails", async ({ expect }) => {
    const ctx = await setup();
    const { ring, handoff } = await reachPayment(ctx);

    await ctx.payments.handleWebhookEvent(handoff.intentId, "failed");

    expect(await ctx.stock.available(ring.id)).toBe(3);
  });

  it("refuses a second element session for the same intent", async ({
    expect,
  }) => {
    const ctx = await setup();
    const intent = await ctx.payments.createIntent(8900, "eur");

    await ctx.payments.createElementSession(intent.id);

    // Two guards protect this, and only the first is reachable sequentially:
    // the status assertion. The version-guarded claim behind it is what catches
    // the genuinely concurrent case, where both calls pass this assertion and
    // only one wins the update.
    await expect(ctx.payments.createElementSession(intent.id)).rejects.toThrow(
      /is 'processing', expected 'created'/,
    );
  });

  it("reports that the memory provider supports an embedded field", async ({
    expect,
  }) => {
    const ctx = await setup();
    expect(ctx.payments.supportsEmbeddedPayment()).toBe(true);
  });
});

describe("a provider with no embedded field", () => {
  const setupRedirectOnly = async () => {
    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with({ provide: PaymentProvider, use: RedirectOnlyProvider })
      .with({
        provide: CheckoutPaymentProvider,
        use: EmbeddedCheckoutPayment,
      })
      .with(AlephaCommerceCheckout);

    const ctx = {
      alepha,
      catalog: alepha.inject(CatalogService),
      carts: alepha.inject(CartService),
      checkout: alepha.inject(CheckoutService),
      payments: alepha.inject(PaymentService),
      stock: alepha.inject(StockService),
    };
    await alepha.start();
    return ctx;
  };

  it("says so, rather than failing silently", async ({ expect }) => {
    const ctx = await setupRedirectOnly();
    expect(ctx.payments.supportsEmbeddedPayment()).toBe(false);
  });

  it("fails with an actionable message when asked for one anyway", async ({
    expect,
  }) => {
    const ctx = await setupRedirectOnly();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 2);
    const cart = await ctx.carts.resolve(ctx.carts.newToken());
    await ctx.carts.add(cart.id, ring.id, 1);
    const opened = await ctx.checkout.start(cart.id);

    // The message must name the fix, because this is a misconfiguration a
    // developer hits once and needs to resolve immediately.
    await expect(
      ctx.checkout.pay(opened.id, { returnUrl: "https://x.example/r" }),
    ).rejects.toThrow(/Register RedirectCheckoutPayment instead/);
  });
});
