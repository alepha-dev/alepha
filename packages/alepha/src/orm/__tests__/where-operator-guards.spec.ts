import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";
import { $entity, $repository, db } from "../core/index.ts";

/**
 * Regression tests for two where-clause shapes that TypeScript accepts (or
 * that arrive as plain data from a request body / saved view) and that the
 * query builder used to translate into something else entirely.
 */

const items = $entity({
  name: "where_guard_items",
  schema: z.object({
    id: db.primaryKey(),
    name: z.text(),
    archivedAt: z.datetime().optional(),
    tags: db.default(z.array(z.text()), []),
  }),
});

class App {
  repository = $repository(items);
}

const boot = async () => {
  const alepha = Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
  const app = alepha.inject(App);
  await alepha.start();
  return app;
};

const seed = async (app: App) => {
  await app.repository.create({
    name: "archived",
    archivedAt: "2026-01-01T00:00:00.000Z",
    tags: ["x", "y"],
  });
  await app.repository.create({ name: "live", tags: ["z"] });
};

describe("isNull / isNotNull honour their value", () => {
  it("should treat isNull: false as IS NOT NULL", async () => {
    const app = await boot();
    await seed(app);

    const rows = await app.repository.findMany({
      where: { archivedAt: { isNull: false } },
    });

    expect(rows.map((it) => it.name)).toEqual(["archived"]);
  });

  it("should treat isNotNull: false as IS NULL", async () => {
    const app = await boot();
    await seed(app);

    const rows = await app.repository.findMany({
      where: { archivedAt: { isNotNull: false } },
    });

    expect(rows.map((it) => it.name)).toEqual(["live"]);
  });

  it("should still treat isNull: true as IS NULL", async () => {
    const app = await boot();
    await seed(app);

    const rows = await app.repository.findMany({
      where: { archivedAt: { isNull: true } },
    });

    expect(rows.map((it) => it.name)).toEqual(["live"]);
  });

  it("should still treat isNotNull: true as IS NOT NULL", async () => {
    const app = await boot();
    await seed(app);

    const rows = await app.repository.findMany({
      where: { archivedAt: { isNotNull: true } },
    });

    expect(rows.map((it) => it.name)).toEqual(["archived"]);
  });
});

describe("array shorthand on an array column", () => {
  it("should compare the array as a value, not recurse into it", async () => {
    const app = await boot();
    await seed(app);

    const rows = await app.repository.findMany({
      where: { tags: ["x", "y"] },
    });

    expect(rows.map((it) => it.name)).toEqual(["archived"]);
  });

  it("should keep 'and' / 'or' arrays working", async () => {
    const app = await boot();
    await seed(app);

    const rows = await app.repository.findMany({
      where: {
        or: [{ name: { eq: "archived" } }, { name: { eq: "live" } }],
      },
      orderBy: "name",
    });

    expect(rows.map((it) => it.name)).toEqual(["archived", "live"]);
  });
});
