import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { currentUserAtom } from "alepha/security";
import type { Cookies } from "alepha/server/cookies";
import { describe, it } from "vitest";

import { CartController } from "../cart/controllers/CartController.ts";
import { CartService } from "../cart/services/CartService.ts";
import { CheckoutController } from "../checkout/controllers/CheckoutController.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { StockService } from "../services/StockService.ts";
import { AlephaCommerceShipping } from "../shipping/index.ts";
import { ShippingService } from "../shipping/services/ShippingService.ts";

const address = {
  fullName: "Camille Dupont",
  line1: "12 rue des Orfèvres",
  locality: "Paris",
  postalCode: "75001",
  country: "FR",
  phone: "0102030405",
};

/**
 * The session uuid travels in URLs, so in logs and referrers. It used to be the
 * only credential: with it, anybody read the buyer's address and phone, changed
 * the email of an open checkout, or moved an unpaid order's delivery.
 */
const setup = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaCommerceShipping);
  const ctx = {
    alepha,
    api: alepha.inject(CheckoutController),
    cartApi: alepha.inject(CartController),
    carts: alepha.inject(CartService),
    catalog: alepha.inject(CatalogService),
    checkout: alepha.inject(CheckoutService),
    payments: alepha.inject(PaymentService),
    shipping: alepha.inject(ShippingService),
    stock: alepha.inject(StockService),
  };
  await alepha.start();
  const zone = await ctx.shipping.createZone({
    name: "France",
    countries: ["FR"],
  });
  await ctx.shipping.createRate({
    zoneId: zone.id,
    code: `colissimo-${randomUUID()}`,
    name: "Colissimo",
    price: 690,
  });
  return ctx;
};

type Ctx = Awaited<ReturnType<typeof setup>>;

/**
 * One browser: its own cookie jar, carried between calls.
 */
const browser = (ctx: Ctx) => {
  const jar: Cookies = { req: {}, res: {} };
  const request: any = { headers: {}, reply: { headers: {} }, cookies: jar };

  return async <R>(fn: () => R | Promise<R>, userId?: string): Promise<R> => {
    const result = await ctx.alepha.context.run(async () => {
      ctx.alepha.set("alepha.http.request", request);
      ctx.alepha.store.set(
        currentUserAtom,
        userId ? ({ id: userId, roles: [] } as any) : undefined,
      );
      return await fn();
    });
    for (const [name, cookie] of Object.entries(jar.res)) {
      if (cookie) jar.req[name] = cookie.value;
    }
    jar.res = {};
    return result;
  };
};

/**
 * A guest reaches an open checkout with an address on file.
 */
const aCheckout = async (ctx: Ctx, visit: ReturnType<typeof browser>) => {
  const ring = await ctx.catalog.create({
    slug: `ring-${randomUUID()}`,
    name: "Bague Aurore",
    price: 8900,
    published: true,
    config: { trackStock: true },
  });
  await ctx.stock.recordIntake(ring.id, 5);
  await visit(() =>
    ctx.cartApi.commerceCartAdd.run({
      body: { productId: ring.id, quantity: 1 },
    }),
  );
  const session = await visit(() =>
    ctx.api.commerceCheckoutStart.run({
      body: { email: "camille@example.com" },
    }),
  );
  await visit(() =>
    ctx.api.commerceCheckoutSetAddress.run({
      params: { id: session.id },
      body: address,
    }),
  );
  return session.id;
};

describe("a checkout session", () => {
  describe("in the hands of whoever opened it", () => {
    it("takes every step, down to the payment", async ({ expect }) => {
      const ctx = await setup();
      const visit = browser(ctx);
      const id = await aCheckout(ctx, visit);

      await visit(() =>
        ctx.api.commerceCheckoutSetEmail.run({
          params: { id },
          body: { email: "autre@example.com" },
        }),
      );
      const { options } = await visit(() =>
        ctx.api.commerceCheckoutShippingOptions.run({ params: { id } }),
      );
      await visit(() =>
        ctx.api.commerceCheckoutSetShippingMethod.run({
          params: { id },
          body: { code: options[0]!.code },
        }),
      );
      const { session } = await visit(() =>
        ctx.api.commerceCheckoutPay.run({
          params: { id },
          body: { returnUrl: "/merci" },
        }),
      );

      expect(session.status).toBe("paying");
    });

    it("follows a customer who signs in on another device", async ({
      expect,
    }) => {
      const ctx = await setup();
      const owner = browser(ctx);
      const userId = randomUUID();
      const ring = await ctx.catalog.create({
        slug: `ring-${randomUUID()}`,
        name: "Bague Aurore",
        price: 8900,
        published: true,
        config: { trackStock: true },
      });
      await owner(
        () =>
          ctx.cartApi.commerceCartAdd.run({
            body: { productId: ring.id, quantity: 1 },
          }),
        userId,
      );
      const session = await owner(
        () => ctx.api.commerceCheckoutStart.run({ body: {} }),
        userId,
      );

      const elsewhere = browser(ctx);
      const updated = await elsewhere(
        () =>
          ctx.api.commerceCheckoutSetEmail.run({
            params: { id: session.id },
            body: { email: "camille@example.com" },
          }),
        userId,
      );

      expect(updated.id).toBe(session.id);
    });
  });

  describe("in the hands of a third party", () => {
    it("refuses every step", async ({ expect }) => {
      const ctx = await setup();
      const id = await aCheckout(ctx, browser(ctx));
      const stranger = browser(ctx);

      const steps: Array<() => Promise<unknown>> = [
        () =>
          ctx.api.commerceCheckoutSetEmail.run({
            params: { id },
            body: { email: "pirate@example.com" },
          }),
        () =>
          ctx.api.commerceCheckoutSetAddress.run({
            params: { id },
            body: { ...address, line1: "1 rue du Vol" },
          }),
        () => ctx.api.commerceCheckoutShippingOptions.run({ params: { id } }),
        () =>
          ctx.api.commerceCheckoutSetShippingMethod.run({
            params: { id },
            body: { code: "colissimo" },
          }),
        () =>
          ctx.api.commerceCheckoutPay.run({
            params: { id },
            body: { returnUrl: "/merci" },
          }),
      ];

      for (const step of steps) {
        await expect(stranger(step)).rejects.toThrow(/not yours/);
      }

      const session = await ctx.checkout.getById(id);
      expect(session.email).toBe("camille@example.com");
      expect(session.status).toBe("open");
    });

    it("refuses a signed-in customer who is somebody else", async ({
      expect,
    }) => {
      const ctx = await setup();
      const id = await aCheckout(ctx, browser(ctx));

      await expect(
        browser(ctx)(
          () =>
            ctx.api.commerceCheckoutSetEmail.run({
              params: { id },
              body: { email: "pirate@example.com" },
            }),
          randomUUID(),
        ),
      ).rejects.toThrow(/not yours/);
    });
  });

  describe("the confirmation", () => {
    const reachPaid = async (ctx: Ctx, visit: ReturnType<typeof browser>) => {
      const id = await aCheckout(ctx, visit);
      const { options } = await visit(() =>
        ctx.api.commerceCheckoutShippingOptions.run({ params: { id } }),
      );
      await visit(() =>
        ctx.api.commerceCheckoutSetShippingMethod.run({
          params: { id },
          body: { code: options[0]!.code },
        }),
      );
      const { handoff } = await visit(() =>
        ctx.api.commerceCheckoutPay.run({
          params: { id },
          body: { returnUrl: "/merci" },
        }),
      );
      await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");
      return { id, intentId: handoff.intentId as string };
    };

    it("tells the buyer where the parcel goes", async ({ expect }) => {
      const ctx = await setup();
      const visit = browser(ctx);
      const { id } = await reachPaid(ctx, visit);

      const data = await visit(() =>
        ctx.api.commerceCheckoutOrder.run({ params: { id } }),
      );

      expect(data.order.shippingAddress).toMatchObject({
        line1: address.line1,
      });
    });

    it("tells a stranger only that an order exists", async ({ expect }) => {
      const ctx = await setup();
      const { id, intentId } = await reachPaid(ctx, browser(ctx));

      // Over HTTP, because a response schema is what strips a field.
      const { data } = await ctx.api.commerceCheckoutOrder.fetch({
        params: { id },
      });

      const text = JSON.stringify(data);
      expect(data.order.number).toBeDefined();
      expect(text).not.toContain(address.line1);
      expect(text).not.toContain(address.phone);
      expect(text).not.toContain(intentId);
    });
  });
});
