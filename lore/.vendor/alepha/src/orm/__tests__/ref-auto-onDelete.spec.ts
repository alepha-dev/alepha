import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import { $entity, $repository, db } from "../core/index.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

describe("db.ref - automatic onDelete behavior", () => {
  const categories = $entity({
    name: "categories",
    schema: z.object({
      id: db.identityPrimaryKey(),
      __v: db.version(),
      name: z.text(),
    }),
  });

  const products = $entity({
    name: "products",
    schema: z.object({
      id: db.identityPrimaryKey(),
      __v: db.version(),
      name: z.text(),
      // Optional reference - should automatically set onDelete: "set null"
      categoryId: db.ref(z.integer().optional(), () => categories.cols.id),
    }),
  });

  const orders = $entity({
    name: "orders",
    schema: z.object({
      id: db.identityPrimaryKey(),
      __v: db.version(),
      orderNumber: z.text(),
      // Required reference - should automatically set onDelete: "cascade"
      productId: db.ref(z.integer(), () => products.cols.id),
    }),
  });

  class App {
    categories = $repository(categories);
    products = $repository(products);
    orders = $repository(orders);
  }

  it("should cascade delete for required references", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const app = alepha.inject(App);
    await alepha.start();

    // Create a product with category
    const category = await app.categories.create({ name: "Electronics" });
    const product = await app.products.create({
      name: "Laptop",
      categoryId: category.id,
    });
    const order = await app.orders.create({
      orderNumber: "ORD-001",
      productId: product.id,
    });

    // Verify data exists
    expect(await app.products.findMany()).toEqual([
      { id: product.id, name: "Laptop", categoryId: category.id, __v: 0 },
    ]);
    expect(await app.orders.findMany()).toEqual([
      { id: order.id, orderNumber: "ORD-001", productId: product.id, __v: 0 },
    ]);

    // Delete product - order should cascade delete (required reference)
    await app.products.deleteById(product.id);

    // Order should be deleted due to cascade
    expect(await app.products.findMany()).toEqual([]);
    expect(await app.orders.findMany()).toEqual([]);
  });

  it("should set null for optional references", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const app = alepha.inject(App);
    await alepha.start();

    // Create product with category
    const category = await app.categories.create({ name: "Electronics" });
    const product = await app.products.create({
      name: "Laptop",
      categoryId: category.id,
    });

    // Verify product has category
    expect(await app.products.findMany()).toEqual([
      { id: product.id, name: "Laptop", categoryId: category.id, __v: 0 },
    ]);

    // Delete category - product should remain but categoryId set to null
    await app.categories.deleteById(category.id);

    // Product should still exist with null categoryId (optional reference)
    expect(await app.categories.findMany()).toEqual([]);
    expect(await app.products.findMany()).toEqual([
      { id: product.id, name: "Laptop", __v: 0 },
    ]);
  });

  it("should allow explicit actions to override auto behavior", async () => {
    // Test that explicit actions are not overridden by auto behavior
    const customCategories = $entity({
      name: "custom_categories",
      schema: z.object({
        id: db.identityPrimaryKey(),
        __v: db.version(),
        name: z.text(),
      }),
    });

    const customProducts = $entity({
      name: "custom_products",
      schema: z.object({
        id: db.identityPrimaryKey(),
        __v: db.version(),
        name: z.text(),
        // Optional reference but explicitly set to cascade
        categoryId: db.ref(
          z.integer().optional(),
          () => customCategories.cols.id,
          {
            onDelete: "cascade",
          },
        ),
      }),
    });

    class CustomApp {
      categories = $repository(customCategories);
      products = $repository(customProducts);
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const app = alepha.inject(CustomApp);
    await alepha.start();

    const category = await app.categories.create({ name: "Books" });
    const product = await app.products.create({
      name: "Novel",
      categoryId: category.id,
    });

    expect(await app.products.findMany()).toEqual([
      { id: product.id, name: "Novel", categoryId: category.id, __v: 0 },
    ]);

    // Delete category - product should cascade delete even though reference is optional
    await app.categories.deleteById(category.id);

    // Product should be deleted due to explicit cascade
    expect(await app.categories.findMany()).toEqual([]);
    expect(await app.products.findMany()).toEqual([]);
  });
});
