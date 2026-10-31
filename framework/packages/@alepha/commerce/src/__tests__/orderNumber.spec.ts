import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { AdminOrderController } from "../admin/controllers/AdminOrderController.ts";
import { AlephaCommerceAdmin } from "../admin/index.ts";
import { DefaultOrderMailRenderer } from "../notifications/providers/OrderMailRenderer.ts";
import { orderConfig } from "../orderConfigAtom.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { OrderService } from "../services/OrderService.ts";

const setup = async (backend: "postgres" | "sqlite" = "postgres") => {
  const alepha =
    backend === "postgres"
      ? Alepha.create().with(AlephaOrmPostgres).with(AlephaCommerceAdmin)
      : Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }).with(
          AlephaCommerceAdmin,
        );
  const ctx = {
    alepha,
    catalog: alepha.inject(CatalogService),
    orders: alepha.inject(OrderService),
    adminOrders: alepha.inject(AdminOrderController),
    mails: alepha.inject(DefaultOrderMailRenderer),
  };
  await alepha.start();
  return ctx;
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const aPiece = (ctx: Ctx) =>
  ctx.catalog.create({
    slug: `piece-${randomUUID()}`,
    name: "Fichier",
    price: 1000,
    published: true,
    config: { trackStock: false },
  });

describe("order numbers", () => {
  describe.each(["postgres", "sqlite"] as const)("on %s", (backend) => {
    it("numbers orders in sequence, in the shop's own format", async ({
      expect,
    }) => {
      const ctx = await setup(backend);
      const piece = await aPiece(ctx);
      const lines = [{ productId: piece.id, quantity: 1 }];

      const first = await ctx.orders.create({ lines });
      const second = await ctx.orders.create({ lines });

      expect(first.number).toMatch(/^CMD-\d{4}-\d{6}$/);
      const sequence = (number?: string) => Number(number?.slice(-6));
      expect(sequence(second.number)).toBe(sequence(first.number) + 1);
    });

    it("never gives two orders one number", async ({ expect }) => {
      const ctx = await setup(backend);
      const piece = await aPiece(ctx);
      const lines = [{ productId: piece.id, quantity: 1 }];

      const orders = await Promise.all(
        Array.from({ length: 10 }, () => ctx.orders.create({ lines })),
      );

      expect(new Set(orders.map((it) => it.number)).size).toBe(10);
    });

    it("takes the prefix from the configuration", async ({ expect }) => {
      const ctx = await setup(backend);
      ctx.alepha.store.set(orderConfig.key, {
        ...ctx.alepha.store.get(orderConfig.key)!,
        numberPrefix: "AA",
      });
      const piece = await aPiece(ctx);

      const order = await ctx.orders.create({
        lines: [{ productId: piece.id, quantity: 1 }],
      });

      expect(order.number).toMatch(/^AA-\d{4}-\d{6}$/);
    });
  });

  describe("the emails", () => {
    it("names the order", async ({ expect }) => {
      const ctx = await setup();
      const piece = await aPiece(ctx);
      const order = await ctx.orders.create({
        lines: [{ productId: piece.id, quantity: 1 }],
      });
      const renderer = ctx.mails;

      const confirmation = await renderer.confirmation(
        order,
        await ctx.orders.itemsOf(order.id),
      );
      const shipped = await renderer.shipped(order);

      expect(confirmation.subject).toContain(order.number);
      expect(shipped.subject).toContain(order.number);
    });
  });

  describe("the back office", () => {
    it("finds an order by a piece of its number", async ({ expect }) => {
      const ctx = await setup();
      const piece = await aPiece(ctx);
      const lines = [{ productId: piece.id, quantity: 1 }];
      await ctx.orders.create({ lines });
      const wanted = await ctx.orders.create({ lines });

      const { data } = await ctx.adminOrders.commerceAdminOrderList.fetch(
        { query: { q: wanted.number!.slice(-6) } },
        { user: { id: randomUUID(), roles: ["admin"] } },
      );

      expect(data.content.map((it) => it.id)).toEqual([wanted.id]);
    });
  });
});
