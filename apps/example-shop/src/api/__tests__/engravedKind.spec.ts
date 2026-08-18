import { randomUUID } from "node:crypto";
import { CatalogService, OrderService, StockService } from "@alepha/commerce";
import { CartService } from "@alepha/commerce/cart";
import { CheckoutService } from "@alepha/commerce/checkout";
import { Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { describe, it } from "vitest";
import { ShopApi } from "../index.ts";
import { WorkshopQueue } from "../WorkshopQueue.ts";

const setup = async () => {
  const alepha = Alepha.create({
    env: {
      APP_NAME: "SHOP_TEST",
      // The repo's vitest config points DATABASE_URL at postgres for every
      // suite; this app runs on sqlite, so it says so.
      DATABASE_URL: ":memory:",
    },
  }).with(ShopApi);

  const catalog = alepha.inject(CatalogService);
  const carts = alepha.inject(CartService);
  const checkout = alepha.inject(CheckoutService);
  const orders = alepha.inject(OrderService);
  const stock = alepha.inject(StockService);
  const payments = alepha.inject(PaymentService);
  const workshop = alepha.inject(WorkshopQueue);

  await alepha.start();

  return {
    alepha,
    catalog,
    carts,
    checkout,
    orders,
    stock,
    payments,
    workshop,
  };
};

describe("shop: a product kind defined by the application", () => {
  it("registers 'engraved' alongside the kinds the package ships", async ({
    expect,
  }) => {
    const { catalog } = await setup();

    const piece = await catalog.create({
      kind: "engraved",
      slug: `bague-${randomUUID()}`,
      name: "Bague Solstice",
      price: 24900,
      published: true,
      config: { maxCharacters: 20, extraLeadDays: 7 },
    });

    expect(piece.kind).toBe("engraved");
  });

  it("runs the application's own fulfilment when the order is paid", async ({
    expect,
  }) => {
    const { catalog, carts, checkout, stock, payments, workshop } =
      await setup();

    const piece = await catalog.create({
      kind: "engraved",
      slug: `bague-${randomUUID()}`,
      name: "Bague Solstice",
      price: 24900,
      published: true,
      config: { maxCharacters: 20, extraLeadDays: 7 },
    });
    await stock.recordIntake(piece.id, 2);

    const cart = await carts.resolve(carts.newToken());
    await carts.add(cart.id, piece.id, 1);
    const session = await checkout.start(cart.id);
    const { handoff } = await checkout.pay(session.id, {
      returnUrl: "https://bijoux.example/merci",
    });

    expect(workshop.tasks).toHaveLength(0);

    await payments.handleWebhookEvent(handoff.intentId, "captured");

    // The package decremented the blank, the application queued the engraving.
    expect(await stock.onHand(piece.id)).toBe(1);
    expect(workshop.tasks).toHaveLength(1);
    expect(workshop.tasks[0]!.leadDays).toBe(7);
  });

  it("rejects an engraving config the workshop cannot honour", async ({
    expect,
  }) => {
    const { catalog } = await setup();

    await expect(
      catalog.create({
        kind: "engraved",
        slug: `bague-${randomUUID()}`,
        name: "Bague impossible",
        price: 24900,
        // 200 characters exceeds the schema's maximum of 60.
        config: { maxCharacters: 200, extraLeadDays: 7 },
      }),
    ).rejects.toThrow();
  });
});
