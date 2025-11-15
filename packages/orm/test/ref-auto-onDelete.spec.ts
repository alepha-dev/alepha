import { Alepha, t } from "@alepha/core";
import { describe, expect, it } from "vitest";
import { $entity, $repository, pg } from "../src";

describe("pg.ref - automatic onDelete behavior", () => {
  const categories = $entity({
    name: "categories",
    schema: t.object({
      id: pg.identityPrimaryKey(),
      __v: pg.version(),
      name: t.text(),
    }),
  });

  const products = $entity({
    name: "products",
    schema: t.object({
      id: pg.identityPrimaryKey(),
      __v: pg.version(),
      name: t.text(),
      // Optional reference - should automatically set onDelete: "set null"
      categoryId: pg.ref(t.optional(t.int()), () => categories.cols.id),
    }),
  });

  const orders = $entity({
    name: "orders",
    schema: t.object({
      id: pg.identityPrimaryKey(),
      __v: pg.version(),
      orderNumber: t.text(),
      // Required reference - should automatically set onDelete: "cascade"
      productId: pg.ref(t.int(), () => products.cols.id),
    }),
  });

  class App {
    categories = $repository(categories);
    products = $repository(products);
    orders = $repository(orders);
  }

  it("should cascade delete for required references", async () => {
    const alepha = Alepha.create();
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
    expect(await app.products.find()).toEqual([
      { id: product.id, name: "Laptop", categoryId: category.id, __v: 0 },
    ]);
    expect(await app.orders.find()).toEqual([
      { id: order.id, orderNumber: "ORD-001", productId: product.id, __v: 0 },
    ]);

    // Delete product - order should cascade delete (required reference)
    await app.products.deleteById(product.id);

    // Order should be deleted due to cascade
    expect(await app.products.find()).toEqual([]);
    expect(await app.orders.find()).toEqual([]);
  });

  it("should set null for optional references", async () => {
    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    // Create product with category
    const category = await app.categories.create({ name: "Electronics" });
    const product = await app.products.create({
      name: "Laptop",
      categoryId: category.id,
    });

    // Verify product has category
    expect(await app.products.find()).toEqual([
      { id: product.id, name: "Laptop", categoryId: category.id, __v: 0 },
    ]);

    // Delete category - product should remain but categoryId set to null
    await app.categories.deleteById(category.id);

    // Product should still exist with null categoryId (optional reference)
    expect(await app.categories.find()).toEqual([]);
    expect(await app.products.find()).toEqual([
      { id: product.id, name: "Laptop", __v: 0 },
    ]);
  });

  it("should allow explicit actions to override auto behavior", async () => {
    // Test that explicit actions are not overridden by auto behavior
    const customCategories = $entity({
      name: "custom_categories",
      schema: t.object({
        id: pg.identityPrimaryKey(),
        __v: pg.version(),
        name: t.text(),
      }),
    });

    const customProducts = $entity({
      name: "custom_products",
      schema: t.object({
        id: pg.identityPrimaryKey(),
        __v: pg.version(),
        name: t.text(),
        // Optional reference but explicitly set to cascade
        categoryId: pg.ref(
          t.optional(t.int()),
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

    const alepha = Alepha.create();
    const app = alepha.inject(CustomApp);
    await alepha.start();

    const category = await app.categories.create({ name: "Books" });
    const product = await app.products.create({
      name: "Novel",
      categoryId: category.id,
    });

    expect(await app.products.find()).toEqual([
      { id: product.id, name: "Novel", categoryId: category.id, __v: 0 },
    ]);

    // Delete category - product should cascade delete even though reference is optional
    await app.categories.deleteById(category.id);

    // Product should be deleted due to explicit cascade
    expect(await app.categories.find()).toEqual([]);
    expect(await app.products.find()).toEqual([]);
  });
});
