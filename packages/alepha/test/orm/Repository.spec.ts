import { Alepha, t } from "alepha";
import { describe, expect, it } from "vitest";
import { $entity, $repository, pg } from "../../src/orm";

const testSchema = t.object({
  id: pg.primaryKey(),
  name: t.text(),
});

const testEntity = $entity({
  name: "test",
  schema: testSchema,
});

describe("Repository", () => {
  it("should handle serial id operations", async () => {
    class App {
      repository = $repository(testEntity);
    }

    const alepha = Alepha.create();

    const app = alepha.inject(App);

    await alepha.start();

    expect(app.repository.id.key).toEqual("id");

    const it = await app.repository.create({ name: "test" });

    expect(await app.repository.findById(it.id)).toEqual(it);
    expect(await app.repository.findById(String(it.id))).toEqual(it);

    const update = await app.repository.updateById(it.id, { name: "2" });

    expect(await app.repository.findById(it.id)).toEqual(update);

    await app.repository.deleteById(it.id);

    expect(await app.repository.count()).toBe(0);
  });

  it("should handle uuid id operations", async () => {
    const schema = t.object({
      uuid: pg.uuidPrimaryKey(),
      name: t.text(),
    });
    const entity = $entity({
      name: "test",
      schema,
    });
    class App {
      repository = $repository(entity);
    }

    const alepha = Alepha.create();

    const app = alepha.inject(App);

    await alepha.start();

    expect(app.repository.id.key).toEqual("uuid");
    expect(app.repository.id.type).toEqual(pg.uuidPrimaryKey());

    const it = await app.repository.create({ name: "test" });

    expect(await app.repository.findById(it.uuid)).toEqual(it);

    const update = await app.repository.updateById(it.uuid, { name: "2" });

    expect(await app.repository.findById(it.uuid)).toEqual(update);

    await app.repository.deleteById(it.uuid);

    expect(await app.repository.count()).toBe(0);
  });

  it("should handle multiple operators (gte & lte)", async () => {
    const schema = t.object({
      id: pg.primaryKey(),
      name: t.text(),
      age: t.number(),
    });
    const entity = $entity({
      name: "test_range",
      schema,
    });
    class App {
      repository = $repository(entity);
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    // Create test data
    await app.repository.create({ name: "Alice", age: 20 });
    await app.repository.create({ name: "Bob", age: 25 });
    await app.repository.create({ name: "Charlie", age: 30 });
    await app.repository.create({ name: "David", age: 35 });
    await app.repository.create({ name: "Eve", age: 40 });

    // Test range query with both gte and lte
    const results = await app.repository.findMany({
      where: {
        age: { gte: 25, lte: 35 },
      },
    });

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.name).sort()).toEqual([
      "Bob",
      "Charlie",
      "David",
    ]);

    // Test with only gte
    const resultsGte = await app.repository.findMany({
      where: {
        age: { gte: 35 },
      },
    });

    expect(resultsGte).toHaveLength(2);
    expect(resultsGte.map((r) => r.name).sort()).toEqual(["David", "Eve"]);

    // Test with only lte
    const resultsLte = await app.repository.findMany({
      where: {
        age: { lte: 25 },
      },
    });

    expect(resultsLte).toHaveLength(2);
    expect(resultsLte.map((r) => r.name).sort()).toEqual(["Alice", "Bob"]);
  });
});
