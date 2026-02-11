import { Alepha, t } from "alepha";
import { describe, expect, it } from "vitest";
import { $entity, $repository, db, pg } from "../index.ts";

const productEntity = $entity({
  name: "products",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),
    sku: t.text(),
    name: t.text(),
    price: t.number(),
  }),
  indexes: [{ column: "sku", unique: true }],
});

class App {
  products = $repository(productEntity);
}

const testUpsert = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  // ========================================
  // INSERT (no conflict)
  // ========================================

  const created = await app.products.upsert({
    id: "00000000-0000-0000-0000-000000000001",
    sku: "WIDGET-1",
    name: "Widget",
    price: 9.99,
  });

  expect(created.id).toBe("00000000-0000-0000-0000-000000000001");
  expect(created.sku).toBe("WIDGET-1");
  expect(created.name).toBe("Widget");
  expect(created.price).toBe(9.99);

  // ========================================
  // UPDATE (conflict on primary key)
  // ========================================

  const upserted = await app.products.upsert({
    id: "00000000-0000-0000-0000-000000000001",
    sku: "WIDGET-1",
    name: "Widget Pro",
    price: 19.99,
  });

  expect(upserted.id).toBe("00000000-0000-0000-0000-000000000001");
  expect(upserted.name).toBe("Widget Pro");
  expect(upserted.price).toBe(19.99);

  // Verify only one record exists
  expect(await app.products.count()).toBe(1);

  // ========================================
  // UPSERT with custom target (unique column)
  // ========================================

  const gadget = await app.products.upsert({
    id: "00000000-0000-0000-0000-000000000002",
    sku: "GADGET-1",
    name: "Gadget",
    price: 29.99,
  });

  expect(gadget.name).toBe("Gadget");

  // Upsert on sku conflict — new id is ignored, existing row is updated
  const gadgetUpdated = await app.products.upsert(
    {
      id: "00000000-0000-0000-0000-000000000099",
      sku: "GADGET-1",
      name: "Gadget v2",
      price: 39.99,
    },
    { target: ["sku"] },
  );

  expect(gadgetUpdated.id).toBe("00000000-0000-0000-0000-000000000002");
  expect(gadgetUpdated.name).toBe("Gadget v2");
  expect(gadgetUpdated.price).toBe(39.99);

  // Still only 2 records
  expect(await app.products.count()).toBe(2);

  // ========================================
  // UPSERT with custom set (partial update)
  // ========================================

  // Only update the price on conflict, keep name unchanged
  const gadgetPartial = await app.products.upsert(
    {
      id: "00000000-0000-0000-0000-000000000002",
      sku: "GADGET-1",
      name: "Should Not Change",
      price: 49.99,
    },
    {
      target: ["sku"],
      set: { price: 49.99 },
    },
  );

  expect(gadgetPartial.id).toBe("00000000-0000-0000-0000-000000000002");
  expect(gadgetPartial.name).toBe("Gadget v2"); // unchanged
  expect(gadgetPartial.price).toBe(49.99); // updated

  // ========================================
  // UPSERT sets updatedAt
  // ========================================

  const beforeUpdate = gadget.updatedAt;
  const gadgetAgain = await app.products.upsert(
    {
      id: "00000000-0000-0000-0000-000000000002",
      sku: "GADGET-1",
      name: "Gadget v3",
      price: 59.99,
    },
    { target: ["sku"] },
  );

  expect(gadgetAgain.updatedAt).not.toBe(beforeUpdate);

  // ========================================
  // UPSERT inserts new record via custom target
  // ========================================

  const newProduct = await app.products.upsert(
    {
      id: "00000000-0000-0000-0000-000000000003",
      sku: "THING-1",
      name: "Thing",
      price: 5.0,
    },
    { target: ["sku"] },
  );

  expect(newProduct.name).toBe("Thing");
  expect(await app.products.count()).toBe(3);
};

describe("$repository - upsert", () => {
  it("should support upsert operations (postgres)", async () => {
    await testUpsert(Alepha.create());
  });

  it("should support upsert operations (pglite)", async () => {
    process.env.DATABASE_URL = "pglite://:memory:";
    await testUpsert(Alepha.create());
  });

  it("should support upsert operations (sqlite)", async () => {
    process.env.DATABASE_URL = "sqlite://:memory:";
    await testUpsert(Alepha.create());
  });
});
