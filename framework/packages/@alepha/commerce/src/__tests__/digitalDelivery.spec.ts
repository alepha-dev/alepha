import { randomUUID } from "node:crypto";

import { $inject, Alepha } from "alepha";
import { $storage } from "alepha/api/files";
import { PaymentService } from "alepha/api/payments";
import { MemoryEmailProvider } from "alepha/email";
import { $repository, AlephaOrmTestPostgres } from "alepha/orm";
import { ServerProvider } from "alepha/server";
import { FileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { CartService } from "../cart/services/CartService.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { DownloadController } from "../downloads/controllers/DownloadController.ts";
import { downloads } from "../downloads/entities/downloads.ts";
import { AlephaCommerceDownloads } from "../downloads/index.ts";
import { DownloadService } from "../downloads/services/DownloadService.ts";
import { AlephaCommerceNotifications } from "../notifications/index.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { OrderService } from "../services/OrderService.ts";
import { AlephaCommerceSettlement } from "../settlement/index.ts";

class Shelf {
  protected readonly fs = $inject(FileSystemProvider);
  public readonly downloads = $storage({ name: "downloads" });
  public readonly rows = $repository(downloads);

  public async store(text: string): Promise<string> {
    const stored = await this.downloads.upload(
      this.fs.createFile({ text, name: "patron.pdf", type: "application/pdf" }),
    );
    return stored.id;
  }
}

const setup = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmTestPostgres)
    .with(AlephaCommerceDownloads)
    .with(AlephaCommerceNotifications)
    .with(AlephaCommerceSettlement);
  const ctx = {
    alepha,
    api: alepha.inject(DownloadController),
    carts: alepha.inject(CartService),
    catalog: alepha.inject(CatalogService),
    checkout: alepha.inject(CheckoutService),
    downloads: alepha.inject(DownloadService),
    orders: alepha.inject(OrderService),
    payments: alepha.inject(PaymentService),
    shelf: alepha.inject(Shelf),
  };
  await alepha.start();
  return ctx;
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const aPattern = async (ctx: Ctx) =>
  ctx.catalog.create({
    kind: "digital",
    slug: `pattern-${randomUUID()}`,
    name: "Patron de robe",
    price: 1200,
    published: true,
    config: { fileId: await ctx.shelf.store("le patron") },
  });

const reachPayment = async (ctx: Ctx, userId?: string) => {
  const pattern = await aPattern(ctx);
  const cart = await ctx.carts.resolve(ctx.carts.newToken(), { userId });
  await ctx.carts.add(cart.id, pattern.id, 1);
  const opened = await ctx.checkout.start(cart.id, {
    userId,
    email: "camille@example.com",
  });
  const { session, handoff } = await ctx.checkout.pay(opened.id, {
    returnUrl: "https://patrons.example/merci",
  });
  return { orderId: session.orderId!, intentId: handoff.intentId };
};

const buy = async (ctx: Ctx, userId?: string) => {
  const reached = await reachPayment(ctx, userId);
  await ctx.payments.handleWebhookEvent(reached.intentId, "captured");
  return reached;
};

const tokenOf = (url: string) => url.split("/").pop()!;

describe("digital delivery", () => {
  describe("the links", () => {
    it("exist from payment, not before", async ({ expect }) => {
      const ctx = await setup();
      const { orderId, intentId } = await reachPayment(ctx);

      expect(await ctx.downloads.linksFor(orderId)).toEqual([]);

      await ctx.payments.handleWebhookEvent(intentId, "captured");

      const links = await ctx.downloads.linksFor(orderId);
      expect(links.map((it) => it.name)).toEqual(["Patron de robe"]);
    });

    it("are the same links however often they are asked for", async ({
      expect,
    }) => {
      const ctx = await setup();
      const { orderId } = await buy(ctx);

      const [first, second] = await Promise.all([
        ctx.downloads.linksFor(orderId),
        ctx.downloads.linksFor(orderId),
      ]);

      expect(first).toEqual(second);
      expect(first).toHaveLength(1);
    });

    it("reach the buyer in the confirmation email", async ({ expect }) => {
      const ctx = await setup();
      const { orderId } = await buy(ctx);
      const [link] = await ctx.downloads.linksFor(orderId);

      const mail = ctx.alepha.inject(MemoryEmailProvider);
      for (
        let attempt = 0;
        attempt < 200 && mail.records.length === 0;
        attempt++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      expect(mail.records[0]!.body).toContain(link!.url);
    });
  });

  describe("the route", () => {
    it("hands over the file behind a link", async ({ expect }) => {
      const ctx = await setup();
      const { orderId } = await buy(ctx);
      const [link] = await ctx.downloads.linksFor(orderId);

      const file = await ctx.downloads.open(tokenOf(link!.url));

      expect(await file.text()).toBe("le patron");
    });

    it("serves it over HTTP, with no account", async ({ expect }) => {
      const ctx = await setup();
      const { orderId } = await buy(ctx);
      const [link] = await ctx.downloads.linksFor(orderId);

      const hostname = ctx.alepha.inject(ServerProvider).hostname;
      const response = await fetch(`${hostname}${link!.url}`);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("le patron");
      expect(response.headers.get("content-disposition")).toContain(
        "patron.pdf",
      );
    });

    it("counts, and stops at the limit, even for two at once", async ({
      expect,
    }) => {
      const ctx = await setup();
      const { orderId } = await buy(ctx);
      const [link] = await ctx.downloads.linksFor(orderId);
      const token = tokenOf(link!.url);
      const [row] = await ctx.shelf.rows.findMany({
        where: { orderId: { eq: orderId } },
      });
      await ctx.shelf.rows.updateById(row!.id, { maxCount: 2 });

      const outcomes = await Promise.allSettled([
        ctx.downloads.open(token),
        ctx.downloads.open(token),
        ctx.downloads.open(token),
      ]);

      expect(outcomes.filter((it) => it.status === "fulfilled")).toHaveLength(
        2,
      );
      expect((await ctx.shelf.rows.getById(row!.id)).count).toBe(2);
    });

    it("stops at the expiry", async ({ expect }) => {
      const ctx = await setup();
      const { orderId } = await buy(ctx);
      const [link] = await ctx.downloads.linksFor(orderId);
      const [row] = await ctx.shelf.rows.findMany({
        where: { orderId: { eq: orderId } },
      });
      await ctx.shelf.rows.updateById(row!.id, {
        expiresAt: "2020-01-01T00:00:00.000Z",
      });

      await expect(ctx.downloads.open(tokenOf(link!.url))).rejects.toThrow(
        /expired/,
      );
    });

    it("stops at a refund", async ({ expect }) => {
      const ctx = await setup();
      const { orderId } = await buy(ctx);
      const [link] = await ctx.downloads.linksFor(orderId);

      await ctx.orders.refund(orderId);

      await expect(ctx.downloads.open(tokenOf(link!.url))).rejects.toThrow(
        /refunded/,
      );
    });

    it("refuses a token nobody issued", async ({ expect }) => {
      const ctx = await setup();

      await expect(ctx.downloads.open("not-a-token-at-all")).rejects.toThrow(
        /No such download/,
      );
    });
  });

  describe("a signed-in customer", () => {
    it("reads their own links, and nobody else's", async ({ expect }) => {
      const ctx = await setup();
      const userId = randomUUID();
      const { orderId } = await buy(ctx, userId);

      const { data } = await ctx.api.commerceOrderDownloads.fetch(
        { params: { id: orderId } },
        { user: { id: userId, roles: ["user"] } },
      );

      expect(data).toHaveLength(1);
      await expect(
        ctx.api.commerceOrderDownloads.fetch(
          { params: { id: orderId } },
          { user: { id: randomUUID(), roles: ["user"] } },
        ),
      ).rejects.toThrow(/does not belong to you/);
    });
  });
});
