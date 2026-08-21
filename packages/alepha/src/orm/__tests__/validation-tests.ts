import { type Alepha, z } from "alepha";
import { expect } from "vitest";

import { $entity, $repository, db } from "../core/index.ts";

const TestEntity = $entity({
  name: "test_validation",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    name: z.text(),
    age: z.number(),
    status: z.text(),
  }),
});

class App {
  items = $repository(TestEntity);
}

// ============================================================================
// testBetweenValidation
// ============================================================================

export const testBetweenValidation = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  const repository = app.items;

  await repository.create({ name: "Item 1", age: 10, status: "active" });
  await repository.create({ name: "Item 2", age: 20, status: "active" });
  await repository.create({ name: "Item 3", age: 30, status: "active" });

  // Valid between with exactly 2 values
  const result1 = await repository.findMany({
    where: { age: { between: [15, 25] } },
  });
  expect(result1).toHaveLength(1);
  expect(result1[0].name).toBe("Item 2");

  // Empty array should throw
  await expect(async () => {
    await repository.findMany({
      where: { age: { between: [] as any } },
    });
  }).rejects.toThrow("between operator requires exactly 2 values [min, max]");

  // Single value should throw
  await expect(async () => {
    await repository.findMany({
      where: { age: { between: [15] as any } },
    });
  }).rejects.toThrow("between operator requires exactly 2 values [min, max]");

  // More than 2 values should throw
  await expect(async () => {
    await repository.findMany({
      where: { age: { between: [15, 25, 35] as any } },
    });
  }).rejects.toThrow("between operator requires exactly 2 values [min, max]");

  // Non-array should throw
  await expect(async () => {
    await repository.findMany({
      where: { age: { between: 15 as any } },
    });
  }).rejects.toThrow("between operator requires exactly 2 values [min, max]");
};

// ============================================================================
// testNotBetweenValidation
// ============================================================================

export const testNotBetweenValidation = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  const repository = app.items;

  await repository.create({ name: "Item 1", age: 10, status: "active" });
  await repository.create({ name: "Item 2", age: 20, status: "active" });
  await repository.create({ name: "Item 3", age: 30, status: "active" });

  // Valid notBetween
  const result1 = await repository.findMany({
    where: { age: { notBetween: [15, 25] } },
    orderBy: { column: "age", direction: "asc" },
  });
  expect(result1).toHaveLength(2);
  expect(result1.map((r: any) => r.name)).toEqual(["Item 1", "Item 3"]);

  // Empty array should throw
  await expect(async () => {
    await repository.findMany({
      where: { age: { notBetween: [] as any } },
    });
  }).rejects.toThrow(
    "notBetween operator requires exactly 2 values [min, max]",
  );

  // Single value should throw
  await expect(async () => {
    await repository.findMany({
      where: { age: { notBetween: [15] as any } },
    });
  }).rejects.toThrow(
    "notBetween operator requires exactly 2 values [min, max]",
  );
};

// ============================================================================
// testInArrayValidation
// ============================================================================

export const testInArrayValidation = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  const repository = app.items;

  await repository.create({ name: "Item 1", age: 10, status: "active" });
  await repository.create({ name: "Item 2", age: 20, status: "pending" });
  await repository.create({ name: "Item 3", age: 30, status: "inactive" });

  // Valid inArray
  const result1 = await repository.findMany({
    where: { status: { inArray: ["active", "pending"] } },
    orderBy: { column: "age", direction: "asc" },
  });
  expect(result1).toHaveLength(2);
  expect(result1.map((r: any) => r.status)).toEqual(["active", "pending"]);

  // Empty array should throw
  await expect(async () => {
    await repository.findMany({
      where: { status: { inArray: [] } },
    });
  }).rejects.toThrow("inArray operator requires at least one value");

  // Non-array should throw
  await expect(async () => {
    await repository.findMany({
      where: { status: { inArray: "active" as any } },
    });
  }).rejects.toThrow("inArray operator requires at least one value");
};

// ============================================================================
// testNotInArrayValidation
// ============================================================================

export const testNotInArrayValidation = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  const repository = app.items;

  await repository.create({ name: "Item 1", age: 10, status: "active" });
  await repository.create({ name: "Item 2", age: 20, status: "pending" });
  await repository.create({ name: "Item 3", age: 30, status: "inactive" });

  // Valid notInArray
  const result1 = await repository.findMany({
    where: { status: { notInArray: ["active", "pending"] } },
  });
  expect(result1).toHaveLength(1);
  expect(result1[0].status).toBe("inactive");

  // Empty array should throw
  await expect(async () => {
    await repository.findMany({
      where: { status: { notInArray: [] } },
    });
  }).rejects.toThrow("notInArray operator requires at least one value");

  // Non-array should throw
  await expect(async () => {
    await repository.findMany({
      where: { status: { notInArray: "active" as any } },
    });
  }).rejects.toThrow("notInArray operator requires at least one value");
};
