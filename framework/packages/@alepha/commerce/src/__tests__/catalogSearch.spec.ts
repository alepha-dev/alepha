import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { describe, it } from "vitest";

import { AdminCategoryController } from "../admin/controllers/AdminCategoryController.ts";
import { AlephaCommerceAdmin } from "../admin/index.ts";
import { CategoryController } from "../controllers/CategoryController.ts";
import { ProductController } from "../controllers/ProductController.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { CategoryService } from "../services/CategoryService.ts";
import { StockService } from "../services/StockService.ts";

const setup = async (backend: "postgres" | "sqlite" = "postgres") => {
  const alepha =
    backend === "postgres"
      ? Alepha.create().with(AlephaOrmTestPostgres).with(AlephaCommerceAdmin)
      : Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }).with(
          AlephaCommerceAdmin,
        );
  const ctx = {
    alepha,
    adminCategories: alepha.inject(AdminCategoryController),
    catalog: alepha.inject(CatalogService),
    categories: alepha.inject(CategoryService),
    categoryApi: alepha.inject(CategoryController),
    productApi: alepha.inject(ProductController),
    stock: alepha.inject(StockService),
  };
  await alepha.start();
  return ctx;
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const aPiece = async (
  ctx: Ctx,
  data: {
    name: string;
    price?: number;
    description?: string;
    categoryId?: string;
    stock?: number;
    kind?: string;
    config?: Record<string, any>;
  },
) => {
  const { stock = 1, ...rest } = data;
  const product = await ctx.catalog.create({
    slug: `piece-${randomUUID()}`,
    price: 1000,
    published: true,
    ...rest,
  });
  if (stock > 0) {
    await ctx.stock.recordIntake(product.id, stock);
  }
  return product;
};

const names = async (
  ctx: Ctx,
  query: Parameters<Ctx["productApi"]["commerceProductList"]["fetch"]>[0],
) => {
  const { data } = await ctx.productApi.commerceProductList.fetch(query);
  return data.content.map((it) => it.name);
};

describe("the public catalogue", () => {
  describe.each(["postgres", "sqlite"] as const)("on %s", (backend) => {
    describe("filters", () => {
      it("narrows to a category and everything under it", async ({
        expect,
      }) => {
        const ctx = await setup(backend);
        const tag = randomUUID();
        const rings = await ctx.categories.create({
          name: "Bagues",
          slug: `bagues-${tag}`,
        });
        const gold = await ctx.categories.create({
          name: "Bagues en or",
          slug: `or-${tag}`,
          parentId: rings.id,
        });
        const necklaces = await ctx.categories.create({
          name: "Colliers",
          slug: `colliers-${tag}`,
        });
        await aPiece(ctx, { name: "Solstice", categoryId: rings.id });
        await aPiece(ctx, { name: "Nadir", categoryId: gold.id });
        await aPiece(ctx, { name: "Aurore", categoryId: necklaces.id });

        expect(
          await names(ctx, {
            query: { category: rings.slug, sort: "name" },
          }),
        ).toEqual(["Nadir", "Solstice"]);
      });

      it("narrows to a price range", async ({ expect }) => {
        const ctx = await setup(backend);
        const tag = randomUUID();
        const category = await ctx.categories.create({
          name: "Tout",
          slug: `tout-${tag}`,
        });
        await aPiece(ctx, {
          name: "Petit",
          price: 1000,
          categoryId: category.id,
        });
        await aPiece(ctx, {
          name: "Moyen",
          price: 5000,
          categoryId: category.id,
        });
        await aPiece(ctx, {
          name: "Grand",
          price: 9000,
          categoryId: category.id,
        });

        expect(
          await names(ctx, {
            query: {
              category: category.slug,
              minPrice: 2000,
              maxPrice: 6000,
            },
          }),
        ).toEqual(["Moyen"]);
      });

      it("keeps what can be bought, and what no ledger counts", async ({
        expect,
      }) => {
        const ctx = await setup(backend);
        const category = await ctx.categories.create({
          name: "Tout",
          slug: `tout-${randomUUID()}`,
        });
        const categoryId = category.id;
        await aPiece(ctx, { name: "Dispo", categoryId });
        await aPiece(ctx, { name: "Jamais rentré", categoryId, stock: 0 });
        const held = await aPiece(ctx, { name: "Retenu", categoryId });
        await ctx.stock.reserve(held.id, 1, { orderId: randomUUID() });
        await aPiece(ctx, {
          name: "Sur commande",
          categoryId,
          stock: 0,
          config: { trackStock: false },
        });
        await aPiece(ctx, {
          name: "Numérique",
          categoryId,
          stock: 0,
          kind: "digital",
          config: { fileId: randomUUID() },
        });

        expect(
          await names(ctx, {
            query: {
              category: category.slug,
              available: true,
              sort: "name",
            },
          }),
        ).toEqual(["Dispo", "Numérique", "Sur commande"]);
      });
    });

    describe("sorting", () => {
      it("sorts by price, newness and name", async ({ expect }) => {
        const ctx = await setup(backend);
        const category = await ctx.categories.create({
          name: "Tout",
          slug: `tout-${randomUUID()}`,
        });
        const categoryId = category.id;
        await aPiece(ctx, { name: "B", price: 300, categoryId });
        await aPiece(ctx, { name: "A", price: 200, categoryId });
        await aPiece(ctx, { name: "C", price: 100, categoryId });
        const inIt = { category: category.slug };

        expect(await names(ctx, { query: { ...inIt, sort: "price" } })).toEqual(
          ["C", "A", "B"],
        );
        expect(
          await names(ctx, { query: { ...inIt, sort: "-price" } }),
        ).toEqual(["B", "A", "C"]);
        expect(await names(ctx, { query: { ...inIt, sort: "name" } })).toEqual([
          "A",
          "B",
          "C",
        ]);
        expect(
          await names(ctx, { query: { ...inIt, sort: "-createdAt" } }),
        ).toEqual(["C", "A", "B"]);
      });
    });

    describe("text search", () => {
      it("finds a word in the name or the description", async ({ expect }) => {
        const ctx = await setup(backend);
        const word = `grenat${randomUUID().slice(0, 8)}`;
        await aPiece(ctx, { name: `Bague ${word}` });
        await aPiece(ctx, {
          name: "Collier",
          description: `Une goutte de ${word} taillée à la main.`,
        });
        await aPiece(ctx, { name: "Bracelet" });

        expect(await names(ctx, { query: { q: word, sort: "name" } })).toEqual([
          `Bague ${word}`,
          "Collier",
        ]);
      });

      it("takes a percent sign for a percent sign", async ({ expect }) => {
        const ctx = await setup(backend);

        expect(await names(ctx, { query: { q: "100%zzz" } })).toEqual([]);
      });
    });
  });

  it("answers an unknown category with a 404", async ({ expect }) => {
    const ctx = await setup();

    await expect(
      ctx.productApi.commerceProductList.fetch({
        query: { category: "nowhere" },
      }),
    ).rejects.toThrow(/No such category/);
  });
});

describe("categories", () => {
  describe("the public list", () => {
    it("answers what is published, in the shop's order", async ({ expect }) => {
      const ctx = await setup();
      const tag = randomUUID();
      await ctx.categories.create({
        name: "Second",
        slug: `second-${tag}`,
        position: 2,
      });
      await ctx.categories.create({
        name: "First",
        slug: `first-${tag}`,
        position: 1,
      });
      await ctx.categories.create({
        name: "Hidden",
        slug: `hidden-${tag}`,
        published: false,
      });

      const { data } = await ctx.categoryApi.commerceCategoryList.fetch();

      expect(
        data.filter((it) => it.slug.endsWith(tag)).map((it) => it.name),
      ).toEqual(["First", "Second"]);
    });
  });

  describe("CategoryService", () => {
    it("refuses to put a category under its own descendant", async ({
      expect,
    }) => {
      const ctx = await setup();
      const tag = randomUUID();
      const parent = await ctx.categories.create({
        name: "Parent",
        slug: `parent-${tag}`,
      });
      const child = await ctx.categories.create({
        name: "Child",
        slug: `child-${tag}`,
        parentId: parent.id,
      });

      await expect(
        ctx.categories.update(parent.id, { parentId: child.id }),
      ).rejects.toThrow(/under itself/);
    });

    it("refuses to delete a category with products or children", async ({
      expect,
    }) => {
      const ctx = await setup();
      const tag = randomUUID();
      const parent = await ctx.categories.create({
        name: "Parent",
        slug: `parent-${tag}`,
      });
      await ctx.categories.create({
        name: "Child",
        slug: `child-${tag}`,
        parentId: parent.id,
      });
      const filled = await ctx.categories.create({
        name: "Filled",
        slug: `filled-${tag}`,
      });
      await aPiece(ctx, { name: "Piece", categoryId: filled.id });

      await expect(ctx.categories.delete(parent.id)).rejects.toThrow(
        /still holds/,
      );
      await expect(ctx.categories.delete(filled.id)).rejects.toThrow(
        /still holds/,
      );
    });
  });

  describe("the back office", () => {
    it("creates a category behind its permission", async ({ expect }) => {
      const ctx = await setup();
      const slug = `bagues-${randomUUID()}`;

      const { data } =
        await ctx.adminCategories.commerceAdminCategoryCreate.fetch(
          { body: { name: "Bagues", slug } },
          { user: { id: randomUUID(), roles: ["admin"] } },
        );

      expect(data.slug).toBe(slug);
      await expect(
        ctx.adminCategories.commerceAdminCategoryCreate.fetch({
          body: { name: "Colliers", slug: `colliers-${randomUUID()}` },
        }),
      ).rejects.toThrow();
    });
  });
});
