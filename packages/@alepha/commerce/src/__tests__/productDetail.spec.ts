import { randomUUID } from "node:crypto";
import { Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import type { UserAccountToken } from "alepha/security";
import { describe, it } from "vitest";
import { AdminProductController } from "../admin/controllers/AdminProductController.ts";
import { AlephaCommerceAdmin } from "../admin/index.ts";
import { CartService } from "../cart/services/CartService.ts";
import { AlephaCommerceCheckout } from "../checkout/index.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { ProductKindHandler } from "../interfaces/ProductKindHandler.ts";
import { ProductKindRegistry } from "../providers/ProductKindRegistry.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { StockService } from "../services/StockService.ts";

/** A kind that takes no configuration at all — neither core kind is one. */
class PlainKindHandler extends ProductKindHandler {
  public readonly kind = "plain";
  public readonly configSchema = undefined;

  public async fulfil(): Promise<void> {
    // Nothing to do: a plain kind hands over nothing the system tracks.
  }
}

const admin: UserAccountToken = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Camille (admin)",
  roles: ["admin"],
};

/**
 * `extraKinds` are registered before `start()`: the container locks on start,
 * so a handler added afterwards throws `ContainerLockedError`.
 */
const setup = async (extraKinds: Array<typeof PlainKindHandler> = []) => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaCommerceCheckout)
    .with(AlephaCommerceAdmin);

  if (extraKinds.length > 0) {
    const registry = alepha.inject(ProductKindRegistry);
    for (const handler of extraKinds) {
      registry.add(alepha.inject(handler));
    }
  }

  const ctx = {
    alepha,
    products: alepha.inject(AdminProductController),
    catalog: alepha.inject(CatalogService),
    carts: alepha.inject(CartService),
    checkout: alepha.inject(CheckoutService),
    stock: alepha.inject(StockService),
    payments: alepha.inject(PaymentService),
  };
  await alepha.start();
  return ctx;
};

const buy = async (
  ctx: Awaited<ReturnType<typeof setup>>,
  productId: string,
) => {
  const cart = await ctx.carts.resolve(ctx.carts.newToken());
  await ctx.carts.add(cart.id, productId, 1);
  const opened = await ctx.checkout.start(cart.id);
  const { session, handoff } = await ctx.checkout.pay(opened.id, {
    returnUrl: "https://bijoux.example/merci",
  });
  await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");
  return session.orderId!;
};

describe("product tax rate", () => {
  /**
   * The gap this whole page exists to close: `products.vatRateBps` and
   * `CatalogService` both carried the field, and only the HTTP body schema did
   * not — so it was silently stripped on every write and a mixed-rate catalogue
   * was unreachable through the API.
   */
  it("round-trips vatRateBps through create", async ({ expect }) => {
    const ctx = await setup();
    const created = await ctx.products.commerceAdminProductCreate(
      {
        body: {
          slug: `book-${randomUUID()}`,
          name: "Catalogue relié",
          price: 2500,
          vatRateBps: 550,
        },
      },
      { user: admin },
    );

    expect(created.vatRateBps).toBe(550);
  });

  it("round-trips vatRateBps through update", async ({ expect }) => {
    const ctx = await setup();
    const product = await ctx.catalog.create({
      slug: `ring-${randomUUID()}`,
      name: "Bague Aurore",
      price: 8900,
    });

    const updated = await ctx.products.commerceAdminProductUpdate(
      { params: { id: product.id }, body: { vatRateBps: 2000 } },
      { user: admin },
    );

    expect(updated.vatRateBps).toBe(2000);
  });
});

describe("draft products", () => {
  it("creates an unpublished placeholder at zero", async ({ expect }) => {
    const ctx = await setup();
    const draft = await ctx.products.commerceAdminProductDraft(
      {},
      { user: admin },
    );

    expect(draft.published).toBe(false);
    expect(draft.price).toBe(0);
    expect(draft.slug).toMatch(/^product-\d+$/);
    expect(draft.name).toBe(draft.slug);
  });

  it("allocates a distinct slug each time", async ({ expect }) => {
    const ctx = await setup();
    const first = await ctx.products.commerceAdminProductDraft(
      {},
      { user: admin },
    );
    const second = await ctx.products.commerceAdminProductDraft(
      {},
      { user: admin },
    );

    expect(second.slug).not.toBe(first.slug);
  });

  /**
   * The slug walks forward from the row count, so a catalogue already holding
   * the slug that count would suggest must step past it rather than fail.
   */
  it("steps past a slug that is already taken", async ({ expect }) => {
    const ctx = await setup();
    await ctx.catalog.create({
      slug: "product-1",
      name: "Occupe la place",
      price: 100,
    });

    const draft = await ctx.products.commerceAdminProductDraft(
      {},
      { user: admin },
    );

    expect(draft.slug).not.toBe("product-1");
  });

  it("leaves the draft out of the public catalogue", async ({ expect }) => {
    const ctx = await setup();
    const draft = await ctx.products.commerceAdminProductDraft(
      {},
      { user: admin },
    );

    const published = await ctx.catalog.list();
    expect(published.content.map((p) => p.id)).not.toContain(draft.id);
  });
});

describe("product deletion", () => {
  it("deletes a product that has never been ordered", async ({ expect }) => {
    const ctx = await setup();
    const draft = await ctx.products.commerceAdminProductDraft(
      {},
      { user: admin },
    );

    await ctx.products.commerceAdminProductDelete(
      { params: { id: draft.id } },
      { user: admin },
    );

    await expect(ctx.catalog.getById(draft.id)).rejects.toThrow();
  });

  /**
   * The guard that makes delete safe to ship at all. Order lines snapshot what
   * they need, so nothing would break — but the catalogue row is what answers
   * "what was this line?" on an old invoice, and there is no undo.
   */
  it("refuses to delete a product that has sold", async ({ expect }) => {
    const ctx = await setup();
    const ring = await ctx.catalog.create({
      slug: `ring-${randomUUID()}`,
      name: "Bague Aurore",
      price: 8900,
      published: true,
    });
    await ctx.stock.recordIntake(ring.id, 1);
    await buy(ctx, ring.id);

    await expect(
      ctx.products.commerceAdminProductDelete(
        { params: { id: ring.id } },
        { user: admin },
      ),
    ).rejects.toThrow(/cannot be deleted/i);

    // Still there, which is the point of refusing.
    expect((await ctx.catalog.getById(ring.id)).id).toBe(ring.id);
  });
});

describe("stock ledger", () => {
  it("reports every movement with its reason", async ({ expect }) => {
    const ctx = await setup();
    const ring = await ctx.catalog.create({
      slug: `ring-${randomUUID()}`,
      name: "Bague Aurore",
      price: 8900,
    });
    await ctx.stock.recordIntake(ring.id, 4, { note: "Livraison" });
    await ctx.stock.recordAdjustment(ring.id, -1, { note: "Casse" });

    const page = await ctx.products.commerceAdminProductMovements(
      { params: { id: ring.id }, query: {} },
      { user: admin },
    );

    expect(page.content).toHaveLength(2);
    expect(page.content.map((m) => m.reason).sort()).toEqual([
      "adjustment",
      "intake",
    ]);
  });

  it("adjusts stock downwards and reports the new figures", async ({
    expect,
  }) => {
    const ctx = await setup();
    const ring = await ctx.catalog.create({
      slug: `ring-${randomUUID()}`,
      name: "Bague Aurore",
      price: 8900,
    });
    await ctx.stock.recordIntake(ring.id, 5);

    const result = await ctx.products.commerceAdminProductAdjustStock(
      {
        params: { id: ring.id },
        body: { quantity: -2, reason: "adjustment", note: "Miscount" },
      },
      { user: admin },
    );

    expect(result.onHand).toBe(3);
    expect(result.available).toBe(3);
  });

  /**
   * A zero movement is a ledger row that says nothing and still shows up in
   * the history an operator reads.
   */
  it("refuses an adjustment of zero", async ({ expect }) => {
    const ctx = await setup();
    const ring = await ctx.catalog.create({
      slug: `ring-${randomUUID()}`,
      name: "Bague Aurore",
      price: 8900,
    });

    await expect(
      ctx.products.commerceAdminProductAdjustStock(
        {
          params: { id: ring.id },
          body: { quantity: 0, reason: "adjustment" },
        },
        { user: admin },
      ),
    ).rejects.toThrow();
  });

  /**
   * A return is an addition the ledger reports apart from a delivery, so a
   * negative quantity sent with that reason must not silently subtract.
   */
  it("treats a return as an addition whatever the sign", async ({ expect }) => {
    const ctx = await setup();
    const ring = await ctx.catalog.create({
      slug: `ring-${randomUUID()}`,
      name: "Bague Aurore",
      price: 8900,
    });

    const result = await ctx.products.commerceAdminProductAdjustStock(
      { params: { id: ring.id }, body: { quantity: -3, reason: "return" } },
      { user: admin },
    );

    expect(result.onHand).toBe(3);
  });
});

describe("product sales", () => {
  it("lists the order lines that sold the product, with order context", async ({
    expect,
  }) => {
    const ctx = await setup();
    const ring = await ctx.catalog.create({
      slug: `ring-${randomUUID()}`,
      name: "Bague Aurore",
      price: 8900,
      published: true,
    });
    await ctx.stock.recordIntake(ring.id, 2);
    const orderId = await buy(ctx, ring.id);

    const page = await ctx.products.commerceAdminProductOrders(
      { params: { id: ring.id }, query: {} },
      { user: admin },
    );

    expect(page.content).toHaveLength(1);
    const line = page.content[0]!;
    expect(line.orderId).toBe(orderId);
    expect(line.quantity).toBe(1);
    // Snapshotted at purchase — this is what it sold for, not today's price.
    expect(line.unitPrice).toBe(8900);
    expect(line.orderStatus).toBe("paid");
    expect(line.orderCreatedAt).toBeTruthy();
  });

  it("is empty for a product that has never sold", async ({ expect }) => {
    const ctx = await setup();
    const draft = await ctx.products.commerceAdminProductDraft(
      {},
      { user: admin },
    );

    const page = await ctx.products.commerceAdminProductOrders(
      { params: { id: draft.id }, query: {} },
      { user: admin },
    );

    expect(page.content).toHaveLength(0);
  });
});

describe("product kind config schemas", () => {
  /**
   * The detail page's config form is built by round-tripping this through
   * `jsonSchemaToZod`, so a kind that declares a schema must ship one and a
   * kind that declares none must be absent — that absence is what tells the UI
   * not to offer the form at all.
   */
  it("ships a JSON Schema for kinds that declare one", async ({ expect }) => {
    const ctx = await setup();
    const { kinds, schemas } = await ctx.products.commerceAdminProductKinds(
      {},
      { user: admin },
    );

    expect(kinds).toContain("digital");
    expect(schemas.digital).toBeTruthy();
    expect(schemas.digital.type).toBe("object");
  });

  /**
   * Both core kinds declare a schema, so the absence contract needs a kind that
   * does not — which is also the case an application hits first, since a kind
   * with no configuration is the simplest one to write.
   */
  it("omits kinds that take no configuration", async ({ expect }) => {
    const ctx = await setup([PlainKindHandler]);

    const { kinds, schemas } = await ctx.products.commerceAdminProductKinds(
      {},
      { user: admin },
    );

    expect(kinds).toContain("plain");
    expect(schemas.plain).toBeUndefined();
  });
});
