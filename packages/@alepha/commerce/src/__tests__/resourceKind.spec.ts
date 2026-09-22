import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { CartService } from "../cart/services/CartService.ts";
import { AlephaCommerceCheckout } from "../checkout/index.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import type { OrderItemEntity } from "../entities/orderItems.ts";
import { ProductKindRegistry } from "../providers/ProductKindRegistry.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { OrderService } from "../services/OrderService.ts";
import { ResourceService } from "../services/ResourceService.ts";
import { type CourtLine, TestCourtKind } from "./fixtures/TestCourtKind.ts";

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
    kind: alepha.inject(TestCourtKind),
    carts: alepha.inject(CartService),
    catalog: alepha.inject(CatalogService),
    checkout: alepha.inject(CheckoutService),
    orders: alepha.inject(OrderService),
    payments: alepha.inject(PaymentService),
    resources: alepha.inject(ResourceService),
  };
  await alepha.start();
  return ctx;
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const at = (hhmm: string) => `2030-01-05T${hhmm}:00.000Z`;

/**
 * A club with two courts of its own, named apart from every other test's.
 */
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

const line = (resourceIds: string[], from = "18:00", to = "19:30") => ({
  resourceIds,
  startsAt: at(from),
  endsAt: at(to),
});

/**
 * An order line built by hand, to drive the handler with no order around it.
 */
const anItem = (lineConfig: CourtLine): OrderItemEntity => ({
  id: randomUUID(),
  createdAt: new Date().toISOString(),
  orderId: randomUUID(),
  productId: randomUUID(),
  kind: "test-court",
  name: "Padel, 90 minutes",
  unitPrice: 3000,
  quantity: 1,
  lineConfig,
});

const payFor = async (
  ctx: Ctx,
  productId: string,
  lineConfig: Record<string, any>,
) => {
  const cart = await ctx.carts.resolve(ctx.carts.newToken());
  await ctx.carts.add(cart.id, productId, 1, lineConfig);
  const opened = await ctx.checkout.start(cart.id);
  return ctx.checkout.pay(opened.id, {
    returnUrl: "https://club.example/merci",
  });
};

describe("resource kind", () => {
  describe.each(["postgres", "sqlite"] as const)("on %s", (backend) => {
    it("holds the slot at pay() and sells it at capture, once", async ({
      expect,
    }) => {
      const ctx = await setup(backend);
      const { product, courts } = await aClub(ctx);

      const { session, handoff } = await payFor(
        ctx,
        product.id,
        line([courts[0]]),
      );
      const orderId = session.orderId!;
      const [item] = await ctx.orders.itemsOf(orderId);

      const held = await ctx.resources.claimsOf(orderId);
      expect(held).toMatchObject([
        { resourceId: courts[0], status: "held", orderItemId: item!.id },
      ]);

      // The slot is gone for everyone else from pay() on.
      await expect(payFor(ctx, product.id, line([courts[0]]))).rejects.toThrow(
        /no room/,
      );

      await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");
      await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");

      expect(
        (await ctx.resources.claimsOf(orderId)).map((it) => [it.id, it.status]),
      ).toEqual([[held[0]!.id, "consumed"]]);
      expect(ctx.kind.materialised).toEqual([item!.id]);
    });

    it("claims and consumes in fulfil() when a counter sale holds nothing", async ({
      expect,
    }) => {
      const ctx = await setup(backend);
      const { product, courts } = await aClub(ctx);

      const order = await ctx.orders.create({
        status: "paid",
        lines: [
          { productId: product.id, quantity: 1, lineConfig: line(courts) },
        ],
      });

      expect(
        (await ctx.resources.claimsOf(order.id)).map((it) => it.status),
      ).toEqual(["consumed", "consumed"]);
      expect(ctx.kind.materialised).toHaveLength(1);

      // And a second counter sale of one of those courts is refused whole.
      await expect(
        ctx.orders.create({
          status: "paid",
          lines: [
            {
              productId: product.id,
              quantity: 1,
              lineConfig: line([courts[1]], "19:00", "20:00"),
            },
          ],
        }),
      ).rejects.toThrow(/no room/);
    });

    it("gives back the claims a line took when one of them loses", async ({
      expect,
    }) => {
      const ctx = await setup(backend);
      const { courts } = await aClub(ctx);
      await ctx.resources.claim(courts[1], {
        ...line([]),
        capacity: 1,
        label: "maintenance",
      });

      // Straight to the handler, outside any transaction: what D1 does, and
      // the one place nothing rolls the first claim back but the handler.
      const item = anItem(line(courts));
      await expect(ctx.kind.reserve(item)).rejects.toThrow(/no room/);

      expect(
        (await ctx.resources.claimsOfItem(item.id)).map((it) => [
          it.resourceId,
          it.status,
        ]),
      ).toEqual([[courts[0], "released"]]);
      expect(
        (
          await ctx.resources.availability(
            [{ resourceId: courts[0], capacity: 1 }],
            line([]),
          )
        ).get(courts[0]),
      ).toHaveLength(1);
    });
  });

  it("holds a line once, however often reserve() runs", async ({ expect }) => {
    const ctx = await setup("sqlite");
    const { courts } = await aClub(ctx);
    const item = anItem(line(courts));

    await ctx.kind.reserve(item);
    await ctx.kind.reserve(item);

    expect(await ctx.resources.claimsOfItem(item.id)).toHaveLength(2);
  });

  it("refuses a line the product cannot sell before anything is held", async ({
    expect,
  }) => {
    const ctx = await setup("sqlite");
    const { product, courts } = await aClub(ctx);
    const cart = await ctx.carts.resolve(ctx.carts.newToken());

    await expect(
      ctx.carts.add(cart.id, product.id, 1, line([`court-${randomUUID()}`])),
    ).rejects.toThrow(/not sold by this product/);
    await expect(
      ctx.carts.add(cart.id, product.id, 2, line([courts[0]])),
    ).rejects.toThrow(/one booking per slot/);
  });

  it("names one lock key per court the line claims", async ({ expect }) => {
    const ctx = await setup("sqlite");
    const item = anItem(line(["a", "b"]));

    expect(ctx.kind.lockKeys(item)).toEqual([
      { namespace: ResourceService.LOCK_NAMESPACE, key: "a" },
      { namespace: ResourceService.LOCK_NAMESPACE, key: "b" },
    ]);
  });
});
