import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { CartService } from "../cart/services/CartService.ts";
import { AlephaCommerceCheckout } from "../checkout/index.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { OrderService } from "../services/OrderService.ts";
import { StockService } from "../services/StockService.ts";
import { AlephaCommerceShipping } from "../shipping/index.ts";
import { ShippingService } from "../shipping/services/ShippingService.ts";

const address = {
  fullName: "Camille Dupont",
  line1: "12 rue des Orfèvres",
  locality: "Paris",
  postalCode: "75001",
  country: "FR",
};

/** With the shipping module wired in. */
const withShipping = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaCommerceShipping);

  const ctx = {
    alepha,
    catalog: alepha.inject(CatalogService),
    carts: alepha.inject(CartService),
    checkout: alepha.inject(CheckoutService),
    orders: alepha.inject(OrderService),
    stock: alepha.inject(StockService),
    shipping: alepha.inject(ShippingService),
    payments: alepha.inject(PaymentService),
  };
  await alepha.start();
  return ctx;
};

/** Checkout alone — the ticketing / downloads case. */
const withoutShipping = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaCommerceCheckout);
  const ctx = {
    alepha,
    catalog: alepha.inject(CatalogService),
    carts: alepha.inject(CartService),
    checkout: alepha.inject(CheckoutService),
  };
  await alepha.start();
  return ctx;
};

const aRing = (catalog: CatalogService, price = 8900) =>
  catalog.create({
    slug: `ring-${randomUUID()}`,
    name: "Bague Aurore",
    price,
    published: true,
    config: { trackStock: true },
  });

const seedZones = async (shipping: ShippingService) => {
  const france = await shipping.createZone({
    name: "France",
    countries: ["FR"],
    priority: 0,
  });
  const eu = await shipping.createZone({
    name: "Union européenne",
    countries: ["FR", "DE", "BE", "IT", "ES", "NL"],
    priority: 10,
  });

  await shipping.createRate({
    zoneId: france.id,
    code: "colissimo",
    name: "Colissimo",
    price: 690,
    freeAbove: 10000,
    minDays: 2,
    maxDays: 3,
  });
  await shipping.createRate({
    zoneId: france.id,
    code: "retrait",
    name: "Retrait en boutique",
    price: 0,
  });
  await shipping.createRate({
    zoneId: eu.id,
    code: "eu-standard",
    name: "Standard UE",
    price: 1490,
  });

  return { france, eu };
};

describe("shipping in the checkout", () => {
  it("quotes the narrow zone before the broad one", async ({ expect }) => {
    const { shipping } = await withShipping();
    await seedZones(shipping);

    // FR is in both zones; the priority-0 French zone wins.
    const zone = await shipping.zoneFor("FR");
    expect(zone?.name).toBe("France");
    // DE is only in the EU zone.
    expect((await shipping.zoneFor("DE"))?.name).toBe("Union européenne");
    // Not covered at all.
    expect(await shipping.zoneFor("PL")).toBeUndefined();
  });

  it("applies free-delivery-above and sorts cheapest first", async ({
    expect,
  }) => {
    const { shipping } = await withShipping();
    await seedZones(shipping);

    const cheap = await shipping.quote("FR", 5000);
    expect(cheap.map((q) => q.code)).toEqual(["retrait", "colissimo"]);
    expect(cheap.find((q) => q.code === "colissimo")!.price).toBe(690);

    const rich = await shipping.quote("FR", 15000);
    const colissimo = rich.find((q) => q.code === "colissimo")!;
    expect(colissimo.price).toBe(0);
    expect(colissimo.free).toBe(true);
    // The list price survives, so a UI can strike it through.
    expect(colissimo.listPrice).toBe(690);
  });

  it("prices delivery into the checkout total", async ({ expect }) => {
    const { catalog, carts, checkout, shipping } = await withShipping();
    await seedZones(shipping);

    const ring = await aRing(catalog);
    const cart = await carts.resolve(carts.newToken());
    await carts.add(cart.id, ring.id, 1);

    const opened = await checkout.start(cart.id);
    // No address yet — delivery is unknown, so it is not charged.
    expect(opened.shippingTotal).toBe(0);
    expect(opened.grandTotal).toBe(8900);

    const addressed = await checkout.setAddress(opened.id, address);
    // Cheapest option for FR is the free in-store pickup.
    expect(addressed.shippingTotal).toBe(0);

    const chosen = await checkout.setShippingMethod(opened.id, "colissimo");
    expect(chosen.shippingMethod).toBe("colissimo");
    expect(chosen.shippingTotal).toBe(690);
    expect(chosen.grandTotal).toBe(9590);
    // VAT is extracted from the inclusive total: 95,90 € at 20 % → 15,98 €.
    expect(chosen.taxTotal).toBe(1598);
  });

  it("clears a stale method when the destination changes", async ({
    expect,
  }) => {
    const { catalog, carts, checkout, shipping } = await withShipping();
    await seedZones(shipping);

    const ring = await aRing(catalog);
    const cart = await carts.resolve(carts.newToken());
    await carts.add(cart.id, ring.id, 1);

    const opened = await checkout.start(cart.id);
    await checkout.setAddress(opened.id, address);
    const chosen = await checkout.setShippingMethod(opened.id, "colissimo");
    expect(chosen.shippingMethod).toBe("colissimo");

    // Moving to Germany must not keep a French-only method.
    const moved = await checkout.setAddress(opened.id, {
      ...address,
      locality: "Berlin",
      postalCode: "10115",
      country: "DE",
    });
    expect(moved.shippingMethod).toBeFalsy();
    expect(
      (await checkout.shippingOptions(opened.id)).map((q) => q.code),
    ).toEqual(["eu-standard"]);
  });

  it("refuses a method that is not offered for the destination", async ({
    expect,
  }) => {
    const { catalog, carts, checkout, shipping } = await withShipping();
    await seedZones(shipping);

    const ring = await aRing(catalog);
    const cart = await carts.resolve(carts.newToken());
    await carts.add(cart.id, ring.id, 1);
    const opened = await checkout.start(cart.id);
    await checkout.setAddress(opened.id, {
      ...address,
      locality: "Berlin",
      postalCode: "10115",
      country: "DE",
    });

    await expect(
      checkout.setShippingMethod(opened.id, "colissimo"),
    ).rejects.toThrow(/not an available delivery option for DE/);
  });

  it("carries the delivery choice and address onto the order", async ({
    expect,
  }) => {
    const { catalog, carts, checkout, orders, stock, shipping, payments } =
      await withShipping();
    await seedZones(shipping);

    const ring = await aRing(catalog);
    await stock.recordIntake(ring.id, 2);
    const cart = await carts.resolve(carts.newToken());
    await carts.add(cart.id, ring.id, 1);

    const opened = await checkout.start(cart.id);
    await checkout.setAddress(opened.id, address);
    await checkout.setShippingMethod(opened.id, "colissimo");

    const { handoff } = await checkout.pay(opened.id, {
      returnUrl: "https://bijoux.example/merci",
    });
    await payments.handleWebhookEvent(handoff.intentId, "captured");

    const settled = await checkout.getById(opened.id);
    const order = await orders.getById(settled.orderId!);

    expect(order.status).toBe("paid");
    expect(order.total).toBe(9590);
    expect(order.shippingMethod).toBe("colissimo");
    expect((order.shippingAddress as any).postalCode).toBe("75001");
  });

  it("refuses to pay when the chosen rate has been withdrawn", async ({
    expect,
  }) => {
    const { catalog, carts, checkout, shipping } = await withShipping();
    const { france } = await seedZones(shipping);

    const ring = await aRing(catalog);
    const cart = await carts.resolve(carts.newToken());
    await carts.add(cart.id, ring.id, 1);
    const opened = await checkout.start(cart.id);
    await checkout.setAddress(opened.id, address);
    await checkout.setShippingMethod(opened.id, "colissimo");

    // The merchant withdraws Colissimo while the buyer is still on the page.
    const rates = await shipping.listRates(france.id);
    const colissimo = rates.find((r) => r.code === "colissimo")!;
    await shipping.deactivateRate(colissimo.id);

    await expect(
      checkout.pay(opened.id, { returnUrl: "https://bijoux.example/merci" }),
    ).rejects.toThrow(/no longer available/);
  });

  it("works with no shipping module at all", async ({ expect }) => {
    const { catalog, carts, checkout } = await withoutShipping();

    const download = await catalog.create({
      kind: "digital",
      slug: `pdf-${randomUUID()}`,
      name: "Guide d'entretien",
      price: 500,
      published: true,
      config: { downloadUrl: "https://example.invalid/guide.pdf" },
    });

    const cart = await carts.resolve(carts.newToken());
    await carts.add(cart.id, download.id, 1);
    const opened = await checkout.start(cart.id);
    const addressed = await checkout.setAddress(opened.id, address);

    // No provider, so no options and nothing charged — not an error.
    expect(await checkout.shippingOptions(opened.id)).toEqual([]);
    expect(addressed.shippingTotal).toBe(0);
    expect(addressed.grandTotal).toBe(500);
  });
});
