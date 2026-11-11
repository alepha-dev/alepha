import { randomUUID } from "node:crypto";

import { CatalogService, StockService } from "@alepha/commerce";
import { CartService } from "@alepha/commerce/cart";
import { CheckoutService } from "@alepha/commerce/checkout";
import { Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import {
  MemoryWebhookTransport,
  WebhookEndpointService,
} from "alepha/api/webhooks";
import { BackgroundTaskProvider } from "alepha/background";
import { WebhookVerifier } from "alepha/security";
import { describe, it } from "vitest";

import { ShopApi } from "../index.ts";

const URL = "https://fulfilment.example.app/hooks";

describe("shop: order webhooks", () => {
  it("a real checkout delivers order.paid once, signed, with the recipient's address and no phone", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: { APP_NAME: "SHOP_TEST", DATABASE_URL: ":memory:" },
    }).with(ShopApi);
    const catalog = alepha.inject(CatalogService);
    const carts = alepha.inject(CartService);
    const checkout = alepha.inject(CheckoutService);
    const stock = alepha.inject(StockService);
    const payments = alepha.inject(PaymentService);
    const endpoints = alepha.inject(WebhookEndpointService);
    const verifier = alepha.inject(WebhookVerifier);
    const background = alepha.inject(BackgroundTaskProvider);
    await alepha.start();
    const transport = alepha.inject(MemoryWebhookTransport);

    const { secret } = await endpoints.create({
      url: URL,
      events: ["order.paid"],
    });

    const ring = await catalog.create({
      slug: `bague-${randomUUID()}`,
      name: "Bague Aurore",
      price: 8900,
      published: true,
      config: { trackStock: true },
    });
    await stock.recordIntake(ring.id, 2);
    const cart = await carts.resolve(carts.newToken());
    await carts.add(cart.id, ring.id, 1);
    const opened = await checkout.start(cart.id, {
      email: "camille@example.com",
    });
    await checkout.setAddress(opened.id, {
      fullName: "Camille Martin",
      line1: "12 rue des Lilas",
      locality: "Lyon",
      postalCode: "69003",
      country: "FR",
      phone: "+33 6 12 34 56 78",
    });
    // The shop delivers: pick the first option it offers.
    const [option] = await checkout.shippingOptions(opened.id);
    await checkout.setShippingMethod(opened.id, option.code);
    const { handoff } = await checkout.pay(opened.id, {
      returnUrl: "https://shop.example.app/merci",
    });
    await payments.handleWebhookEvent(handoff.intentId, "captured");
    for (let i = 0; i < 50 && !transport.wasDelivered("order.paid", URL); i++) {
      await background.flush();
      await new Promise((r) => setTimeout(r, 20));
    }

    const sent = transport.deliveriesFor(URL);
    expect(sent).toHaveLength(1);
    expect(sent[0].envelope.type).toBe("order.paid");
    const data = sent[0].envelope.data as Record<string, any>;
    expect(data.shippingAddress).toEqual({
      fullName: "Camille Martin",
      line1: "12 rue des Lilas",
      locality: "Lyon",
      postalCode: "69003",
      country: "FR",
    });
    expect(sent[0].body).not.toContain("+33 6");
    expect(sent[0].body).not.toContain("camille@example.com");
    await expect(
      verifier.verify({ headers: sent[0].headers, body: sent[0].body, secret }),
    ).resolves.toBeUndefined();

    await alepha.stop();
  });
});
