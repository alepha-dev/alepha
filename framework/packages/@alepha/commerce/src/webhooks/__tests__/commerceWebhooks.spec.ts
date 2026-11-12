import { randomUUID } from "node:crypto";

import { $inject, Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import {
  MemoryWebhookTransport,
  WebhookEndpointService,
} from "alepha/api/webhooks";
import { BackgroundTaskProvider } from "alepha/background";
import { $repository, AlephaOrmTestPostgres } from "alepha/orm";
import { WebhookVerifier } from "alepha/security";
import { describe, it } from "vitest";

import { CartService } from "../../cart/services/CartService.ts";
import { AlephaCommerceCheckout } from "../../checkout/index.ts";
import { CheckoutService } from "../../checkout/services/CheckoutService.ts";
import { orderItems } from "../../entities/orderItems.ts";
import { orders } from "../../entities/orders.ts";
import { CatalogService } from "../../services/CatalogService.ts";
import { OrderService } from "../../services/OrderService.ts";
import { ReturnService } from "../../services/ReturnService.ts";
import { StockService } from "../../services/StockService.ts";
import { AlephaCommerceWebhooks } from "../index.ts";
import { CommerceWebhookPayloads } from "../services/CommerceWebhookPayloads.ts";

const URL = "https://fulfilment.example.app/hooks";

const ADDRESS = {
  fullName: "Camille Martin",
  line1: "12 rue des Lilas",
  line2: "Bâtiment B",
  locality: "Lyon",
  region: "Rhône",
  postalCode: "69003",
  country: "FR",
  phone: "+33 6 12 34 56 78",
};

/**
 * Poll `fn` until `predicate` holds, or throw on timeout.
 */
async function waitFor<T>(
  fn: () => Promise<T> | T,
  predicate: (v: T) => boolean,
  { timeout = 5000, interval = 20, label = "condition" } = {},
): Promise<T> {
  const deadline = Date.now() + timeout;
  let last: T = await fn();
  while (Date.now() < deadline) {
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, interval));
    last = await fn();
  }
  if (predicate(last)) return last;
  throw new Error(`waitFor: ${label} not met within ${timeout}ms`);
}

class Shop {
  catalog = $inject(CatalogService);
  carts = $inject(CartService);
  checkout = $inject(CheckoutService);
  stock = $inject(StockService);
  payments = $inject(PaymentService);
  ordersService = $inject(OrderService);
  returns = $inject(ReturnService);
  endpoints = $inject(WebhookEndpointService);
  verifier = $inject(WebhookVerifier);
  background = $inject(BackgroundTaskProvider);
  payloads = $inject(CommerceWebhookPayloads);
  orders = $repository(orders);
  items = $repository(orderItems);
}

/**
 * A payloads builder that cannot build: the listener must swallow it.
 */
class BrokenPayloads extends CommerceWebhookPayloads {
  public override async paid(): Promise<never> {
    throw new Error("payload store down");
  }
}

const boot = async (options: { broken?: boolean } = {}) => {
  const alepha = Alepha.create().with(AlephaOrmTestPostgres);
  if (options.broken) {
    alepha.with({ provide: CommerceWebhookPayloads, use: BrokenPayloads });
  }
  alepha.with(AlephaCommerceCheckout).with(AlephaCommerceWebhooks);
  const shop = alepha.inject(Shop);
  await alepha.start();
  return { alepha, shop, transport: alepha.inject(MemoryWebhookTransport) };
};

/**
 * A real cart, checkout and captured payment webhook; returns the order.
 */
const payOneOrder = async (
  shop: Shop,
  address: Record<string, string> | null = ADDRESS,
) => {
  const ring = await shop.catalog.create({
    slug: `ring-${randomUUID()}`,
    name: "Bague Aurore",
    price: 8900,
    published: true,
    config: { trackStock: true },
  } as any);
  await shop.stock.recordIntake(ring.id, 2);
  const cart = await shop.carts.resolve(shop.carts.newToken());
  await shop.carts.add(cart.id, ring.id, 1);
  const opened = await shop.checkout.start(cart.id, {
    email: "camille@example.com",
  });
  if (address) await shop.checkout.setAddress(opened.id, address as any);
  const { handoff } = await shop.checkout.pay(opened.id, {
    returnUrl: "https://shop.example.app/merci",
  });
  await shop.payments.handleWebhookEvent(handoff.intentId, "captured");
  const session = await shop.checkout.getById(opened.id);
  if (!session.orderId) throw new Error("checkout produced no order");
  return session.orderId;
};

const FORBIDDEN = [
  "email",
  "phone",
  "userId",
  "vatNumber",
  "notes",
  "billingAddress",
  "paymentIntentId",
];

describe("commerce webhooks", () => {
  it("a real checkout delivers order.paid once, signed, with the designed payload", async ({
    expect,
  }) => {
    const { shop, transport } = await boot();
    const { secret } = await shop.endpoints.create({ url: URL });
    const orderId = await payOneOrder(shop);

    await waitFor(
      () => transport.deliveriesFor(URL).length,
      (n) => n >= 1,
      { label: "order.paid delivered" },
    );
    await shop.background.flush();
    const paid = transport
      .deliveriesFor(URL)
      .filter((it) => it.envelope.type === "order.paid");
    expect(paid).toHaveLength(1);
    expect(transport.wasDelivered("order.paid", URL)).toBe(true);

    const data = paid[0].envelope.data as Record<string, any>;
    expect(Object.keys(data).sort()).toEqual(
      [
        "createdAt",
        "currency",
        "discountTotal",
        "items",
        "orderId",
        "paidAt",
        "shippingAddress",
        "shippingTotal",
        "status",
        "taxTotal",
        "total",
        ...(data.number ? ["number"] : []),
        ...(data.shippingMethod ? ["shippingMethod"] : []),
      ].sort(),
    );
    expect(data.orderId).toBe(orderId);
    expect(Object.keys(data.shippingAddress).sort()).toEqual(
      [
        "country",
        "fullName",
        "line1",
        "line2",
        "locality",
        "postalCode",
        "region",
      ].sort(),
    );
    expect(data.items).toEqual([
      expect.objectContaining({ name: "Bague Aurore", quantity: 1 }),
    ]);
    for (const item of data.items) {
      expect(
        Object.keys(item).every((it) =>
          ["sku", "name", "quantity", "unitPrice"].includes(it),
        ),
      ).toBe(true);
    }
    const body = paid[0].body;
    for (const key of FORBIDDEN) {
      expect(body).not.toContain(`"${key}"`);
    }
    expect(body).not.toContain("camille@example.com");
    expect(body).not.toContain("+33 6");

    await expect(
      shop.verifier.verify({
        headers: paid[0].headers,
        body: paid[0].body,
        secret,
      }),
    ).resolves.toBeUndefined();
  });

  it("an order without a usable address is sent without shippingAddress", async ({
    expect,
  }) => {
    const { shop, transport } = await boot();
    await shop.endpoints.create({ url: URL });
    const orderId = await payOneOrder(shop, null);
    await waitFor(
      () => transport.lastEnvelope("order.paid"),
      (it) => it !== undefined,
    );
    const data = transport.lastEnvelope("order.paid")!.data as Record<
      string,
      unknown
    >;
    expect(data.orderId).toBe(orderId);
    expect(data).not.toHaveProperty("shippingAddress");

    // A stored value missing a required key (made outside the checkout).
    await shop.orders.updateById(orderId, {
      shippingAddress: { line1: "1 rue", country: "FR" },
    });
    const payload = await shop.payloads.paid(orderId);
    expect(payload).not.toHaveProperty("shippingAddress");
  });

  it("order.shipped, order.refunded, return.requested and order.cancelled carry exactly their keys", async ({
    expect,
  }) => {
    const { shop, transport } = await boot();
    await shop.endpoints.create({ url: URL });
    const orderId = await payOneOrder(shop);
    await shop.ordersService.markShipped(orderId, {
      trackingNumber: "TRK123",
      trackingUrl: "https://carrier.example.app/TRK123",
    });
    const [item] = await shop.items.findMany({
      where: { orderId: { eq: orderId } },
    });
    await shop.returns.request(orderId, {
      lines: [{ orderItemId: item.id, quantity: 1 }],
      reason: "Too small, call me on +33 6 12 34 56 78",
    });
    await shop.ordersService.refund(orderId, { reason: "Returned" });
    await shop.background.flush();

    const unpaid = await shop.orders.create({
      status: "pending",
      total: 1000,
      currency: "EUR",
    } as any);
    await shop.ordersService.cancel(unpaid.id);
    await shop.background.flush();

    const data = async (type: string) =>
      (await waitFor(
        () => transport.lastEnvelope(type),
        (it) => it !== undefined,
        { label: type },
      ))!.data as Record<string, any>;

    const shipped = await data("order.shipped");
    expect(Object.keys(shipped).sort()).toEqual(
      [
        "items",
        "orderId",
        "shippedAt",
        "shippingAddress",
        "status",
        "trackingNumber",
        "trackingUrl",
        ...(shipped.number ? ["number"] : []),
        ...(shipped.shippingMethod ? ["shippingMethod"] : []),
      ].sort(),
    );
    expect(shipped.shippingAddress).not.toHaveProperty("phone");

    const returned = await data("return.requested");
    expect(Object.keys(returned).sort()).toEqual(
      [
        "lines",
        "orderId",
        "requestedAt",
        "returnId",
        ...(returned.number ? ["number"] : []),
      ].sort(),
    );

    const refunded = await data("order.refunded");
    expect(Object.keys(refunded).sort()).toEqual(
      [
        "amount",
        "currency",
        "orderId",
        "refundId",
        "refundedAt",
        "refundedTotal",
        "status",
        "total",
        ...(refunded.number ? ["number"] : []),
      ].sort(),
    );

    const cancelled = await data("order.cancelled");
    expect(Object.keys(cancelled).sort()).toEqual(
      [
        "cancelledAt",
        "currency",
        "orderId",
        "status",
        "total",
        ...(cancelled.number ? ["number"] : []),
      ].sort(),
    );

    const everything = JSON.stringify(transport.requests.map((it) => it.body));
    expect(everything).not.toContain("+33 6");
    expect(everything).not.toContain("camille@example.com");
    expect(everything).not.toContain("Too small");
  });

  it("a webhook that cannot be built never fails the settlement", async ({
    expect,
  }) => {
    const { shop, transport } = await boot({ broken: true });
    await shop.endpoints.create({ url: URL });
    const orderId = await payOneOrder(shop);
    await shop.background.flush();
    const order = await shop.orders.getById(orderId);
    expect(order.status === "paid" || order.status === "fulfilled").toBe(true);
    expect(transport.wasDelivered("order.paid")).toBe(false);
  });
});
