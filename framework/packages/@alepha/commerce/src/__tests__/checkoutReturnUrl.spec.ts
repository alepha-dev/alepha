import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { checkoutConfig } from "../checkout/checkoutConfigAtom.ts";
import { CheckoutController } from "../checkout/controllers/CheckoutController.ts";
import { AlephaCommerceCheckout } from "../checkout/index.ts";

/**
 * `returnUrl` is where the customer lands the instant after paying, which is
 * the moment they are most primed to trust what they see. It used to be handed
 * to the payment rail verbatim, so a crafted request could park any address
 * there.
 */
class TestCheckoutController extends CheckoutController {
  public testResolveReturnUrl = this.resolveReturnUrl.bind(this);
}

const setup = async (baseUrl?: string) => {
  const alepha = Alepha.create()
    .with({ provide: CheckoutController, use: TestCheckoutController })
    .with(AlephaOrmPostgres)
    .with(AlephaCommerceCheckout);
  if (baseUrl !== undefined) {
    alepha.store.mut(checkoutConfig, (c) => ({ ...c, baseUrl }));
  }
  const controller = alepha.inject(
    CheckoutController,
  ) as TestCheckoutController;
  await alepha.start();
  return { alepha, resolve: controller.testResolveReturnUrl };
};

const requestUrl = new URL("https://boutique.example/api/commerce/checkout");

describe("checkout returnUrl", () => {
  it("resolves a path against the configured base URL", async ({ expect }) => {
    const { alepha, resolve } = await setup("https://boutique.example");

    expect(resolve("/merci", requestUrl)).toBe(
      "https://boutique.example/merci",
    );
    expect(resolve("/merci?ref=1", requestUrl)).toBe(
      "https://boutique.example/merci?ref=1",
    );

    await alepha.stop();
  });

  it("rejects a foreign origin", async ({ expect }) => {
    const { alepha, resolve } = await setup("https://boutique.example");

    expect(() => resolve("https://evil.example/steal", requestUrl)).toThrow(
      /returnUrl must be a path/,
    );

    await alepha.stop();
  });

  it("rejects the shapes a browser would normalise into another origin", async ({
    expect,
  }) => {
    const { alepha, resolve } = await setup("https://boutique.example");

    // Protocol-relative: `//evil.example` is a full URL to a browser.
    expect(() => resolve("//evil.example/steal", requestUrl)).toThrow();
    // Backslashes, which some browsers fold into forward slashes.
    expect(() => resolve("/\\evil.example", requestUrl)).toThrow();
    expect(() => resolve("javascript:alert(1)", requestUrl)).toThrow();

    await alepha.stop();
  });

  it("accepts an absolute URL back to the same origin", async ({ expect }) => {
    const { alepha, resolve } = await setup("https://boutique.example");

    expect(resolve("https://boutique.example/merci", requestUrl)).toBe(
      "https://boutique.example/merci",
    );

    await alepha.stop();
  });

  it("falls back to the request's own origin when no base URL is set", async ({
    expect,
  }) => {
    const { alepha, resolve } = await setup();

    expect(resolve("/merci", requestUrl)).toBe(
      "https://boutique.example/merci",
    );
    expect(() => resolve("https://evil.example/steal", requestUrl)).toThrow();

    await alepha.stop();
  });
});
