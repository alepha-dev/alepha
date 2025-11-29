import { Alepha, t } from "alepha";
import { $entity, $repository, pg } from "alepha/orm";
import { test } from "vitest";

const TestEntity = $entity({
  name: "test_validation",
  schema: t.object({
    id: pg.primaryKey(),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),
    name: t.text(),
    age: t.number(),
    status: t.text(),
  }),
});

class App {
  items = $repository(TestEntity);
}

test("between operator validation - requires exactly 2 values", async ({
  expect,
}) => {
  const alepha = Alepha.create();
  const app = alepha.inject(App);
  await alepha.start();

  const repository = app.items;

  // Insert test data
  await repository.create({ name: "Item 1", age: 10, status: "active" });
  await repository.create({ name: "Item 2", age: 20, status: "active" });
  await repository.create({ name: "Item 3", age: 30, status: "active" });

  // Test 1: Valid between with exactly 2 values should work
  const result1 = await repository.findMany({
    where: { age: { between: [15, 25] } },
  });
  expect(result1).toHaveLength(1);
  expect(result1[0].name).toBe("Item 2");

  // Test 2: Empty array should throw
  await expect(async () => {
    await repository.findMany({
      where: { age: { between: [] as any } },
    });
  }).rejects.toThrow("between operator requires exactly 2 values [min, max]");

  // Test 3: Single value should throw
  await expect(async () => {
    await repository.findMany({
      where: { age: { between: [15] as any } },
    });
  }).rejects.toThrow("between operator requires exactly 2 values [min, max]");

  // Test 4: More than 2 values should throw
  await expect(async () => {
    await repository.findMany({
      where: { age: { between: [15, 25, 35] as any } },
    });
  }).rejects.toThrow("between operator requires exactly 2 values [min, max]");

  // Test 5: Non-array should throw
  await expect(async () => {
    await repository.findMany({
      where: { age: { between: 15 as any } },
    });
  }).rejects.toThrow("between operator requires exactly 2 values [min, max]");
});

test("notBetween operator validation - requires exactly 2 values", async ({
  expect,
}) => {
  const alepha = Alepha.create();
  const app = alepha.inject(App);
  await alepha.start();

  const repository = app.items;

  // Insert test data
  await repository.create({ name: "Item 1", age: 10, status: "active" });
  await repository.create({ name: "Item 2", age: 20, status: "active" });
  await repository.create({ name: "Item 3", age: 30, status: "active" });

  // Test 1: Valid notBetween with exactly 2 values should work
  const result1 = await repository.findMany({
    where: { age: { notBetween: [15, 25] } },
    orderBy: { column: "age", direction: "asc" },
  });
  expect(result1).toHaveLength(2);
  expect(result1.map((r: any) => r.name)).toEqual(["Item 1", "Item 3"]);

  // Test 2: Empty array should throw
  await expect(async () => {
    await repository.findMany({
      where: { age: { notBetween: [] as any } },
    });
  }).rejects.toThrow(
    "notBetween operator requires exactly 2 values [min, max]",
  );

  // Test 3: Single value should throw
  await expect(async () => {
    await repository.findMany({
      where: { age: { notBetween: [15] as any } },
    });
  }).rejects.toThrow(
    "notBetween operator requires exactly 2 values [min, max]",
  );
});

test("inArray operator validation - requires at least one value", async ({
  expect,
}) => {
  const alepha = Alepha.create();
  const app = alepha.inject(App);
  await alepha.start();

  const repository = app.items;

  // Insert test data
  await repository.create({ name: "Item 1", age: 10, status: "active" });
  await repository.create({ name: "Item 2", age: 20, status: "pending" });
  await repository.create({ name: "Item 3", age: 30, status: "inactive" });

  // Test 1: Valid inArray should work
  const result1 = await repository.findMany({
    where: { status: { inArray: ["active", "pending"] } },
    orderBy: { column: "age", direction: "asc" },
  });
  expect(result1).toHaveLength(2);
  expect(result1.map((r: any) => r.status)).toEqual(["active", "pending"]);

  // Test 2: Empty array should throw
  await expect(async () => {
    await repository.findMany({
      where: { status: { inArray: [] } },
    });
  }).rejects.toThrow("inArray operator requires at least one value");

  // Test 3: Non-array should throw
  await expect(async () => {
    await repository.findMany({
      where: { status: { inArray: "active" as any } },
    });
  }).rejects.toThrow("inArray operator requires at least one value");
});

test("notInArray operator validation - requires at least one value", async ({
  expect,
}) => {
  const alepha = Alepha.create();
  const app = alepha.inject(App);
  await alepha.start();

  const repository = app.items;

  // Insert test data
  await repository.create({ name: "Item 1", age: 10, status: "active" });
  await repository.create({ name: "Item 2", age: 20, status: "pending" });
  await repository.create({ name: "Item 3", age: 30, status: "inactive" });

  // Test 1: Valid notInArray should work
  const result1 = await repository.findMany({
    where: { status: { notInArray: ["active", "pending"] } },
  });
  expect(result1).toHaveLength(1);
  expect(result1[0].status).toBe("inactive");

  // Test 2: Empty array should throw
  await expect(async () => {
    await repository.findMany({
      where: { status: { notInArray: [] } },
    });
  }).rejects.toThrow("notInArray operator requires at least one value");

  // Test 3: Non-array should throw
  await expect(async () => {
    await repository.findMany({
      where: { status: { notInArray: "active" as any } },
    });
  }).rejects.toThrow("notInArray operator requires at least one value");
});
