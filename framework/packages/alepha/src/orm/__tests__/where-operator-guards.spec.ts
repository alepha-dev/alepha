import { Alepha, AlephaError, z } from "alepha";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { describe, it } from "vitest";

import { $entity, $relations, $repository, db } from "../core/index.ts";

/**
 * Where-clause shapes that TypeScript accepts (or that arrive as plain data
 * from a request body / saved view) and that must never be translated into
 * something else: a flag read backwards, an array recursed into, or an
 * operator dropped because its value is `undefined` or `null`, which leaves
 * the statement unscoped.
 */

const items = $entity({
  name: "where_guard_items",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    name: z.text(),
    rank: z.integer().optional(),
    archivedAt: z.datetime().optional(),
    tags: db.default(z.array(z.text()), []),
  }),
});

const notes = $entity({
  name: "where_guard_notes",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    itemId: db.ref(z.integer(), () => items.cols.id),
    body: z.text(),
  }),
});

const relations = $relations({ items, notes }, (r) => ({
  items: {
    notes: r.many.notes({ from: r.items.id, to: r.notes.itemId }),
  },
}));

class App {
  repository = $repository(items);
  related = $repository(relations, "items");
  notes = $repository(relations, "notes");
}

type Boot = () => Promise<App>;

const dialects: Array<[string, () => Alepha]> = [
  [
    "sqlite",
    () => Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
  ],
  ["postgres", () => Alepha.create().with(AlephaOrmTestPostgres)],
];

const seed = async (app: App) => {
  await app.repository.create({
    name: "archived",
    archivedAt: "2026-01-01T00:00:00.000Z",
    tags: ["x", "y"],
  });
  await app.repository.create({ name: "live", tags: ["z"] });
};

/**
 * Every operator, given `undefined` then `null`.
 */
const OPERATORS = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "inArray",
  "notInArray",
  "isNull",
  "isNotNull",
  "like",
  "notLike",
  "ilike",
  "notIlike",
  "eqInsensitive",
  "contains",
  "startsWith",
  "endsWith",
  "between",
  "notBetween",
  "arrayContains",
  "arrayContained",
  "arrayOverlaps",
] as const;

for (const [dialect, create] of dialects) {
  const boot: Boot = async () => {
    const alepha = create();
    const app = alepha.inject(App);
    await alepha.start();
    return app;
  };

  describe(`where guards (${dialect})`, () => {
    describe("isNull / isNotNull honour their value", () => {
      it("should treat isNull: false as IS NOT NULL", async ({ expect }) => {
        const app = await boot();
        await seed(app);

        const rows = await app.repository.findMany({
          where: { archivedAt: { isNull: false } },
        });

        expect(rows.map((it) => it.name)).toEqual(["archived"]);
      });

      it("should treat isNotNull: false as IS NULL", async ({ expect }) => {
        const app = await boot();
        await seed(app);

        const rows = await app.repository.findMany({
          where: { archivedAt: { isNotNull: false } },
        });

        expect(rows.map((it) => it.name)).toEqual(["live"]);
      });

      it("should still treat isNull: true as IS NULL", async ({ expect }) => {
        const app = await boot();
        await seed(app);

        const rows = await app.repository.findMany({
          where: { archivedAt: { isNull: true } },
        });

        expect(rows.map((it) => it.name)).toEqual(["live"]);
      });

      it("should still treat isNotNull: true as IS NOT NULL", async ({
        expect,
      }) => {
        const app = await boot();
        await seed(app);

        const rows = await app.repository.findMany({
          where: { archivedAt: { isNotNull: true } },
        });

        expect(rows.map((it) => it.name)).toEqual(["archived"]);
      });
    });

    describe("array shorthand on an array column", () => {
      it("should compare the array as a value, not recurse into it", async ({
        expect,
      }) => {
        const app = await boot();
        await seed(app);

        const rows = await app.repository.findMany({
          where: { tags: ["x", "y"] },
        });

        expect(rows.map((it) => it.name)).toEqual(["archived"]);
      });

      it("should keep 'and' / 'or' arrays working", async ({ expect }) => {
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

    describe("an operator whose value is undefined or null", () => {
      it("should throw for every operator instead of dropping the filter", async ({
        expect,
      }) => {
        const app = await boot();
        await seed(app);

        for (const operator of OPERATORS) {
          for (const value of [undefined, null]) {
            const where = { name: { [operator]: value } } as never;
            await expect(
              app.repository.findMany({ where }),
              `${operator}: ${value}`,
            ).rejects.toThrow(AlephaError);
            await expect(
              app.repository.findMany({ where }),
              `${operator}: ${value}`,
            ).rejects.toThrow(`'${operator}: ${value}'`);
          }
        }
      });

      it("should throw beside a valid operator of the same column", async ({
        expect,
      }) => {
        const app = await boot();
        await seed(app);

        await expect(
          app.repository.findMany({
            where: { rank: { gte: 0, lte: undefined } } as never,
          }),
        ).rejects.toThrow("'lte: undefined'");
      });

      it("should throw on count, paginate, findOne and inside and / or / not", async ({
        expect,
      }) => {
        const app = await boot();
        await seed(app);
        const where = { rank: { gt: undefined } } as never;

        await expect(app.repository.count(where)).rejects.toThrow(AlephaError);
        await expect(app.repository.paginate({}, { where })).rejects.toThrow(
          AlephaError,
        );
        await expect(app.repository.findOne({ where })).rejects.toThrow(
          AlephaError,
        );
        for (const key of ["and", "or"]) {
          await expect(
            app.repository.findMany({ where: { [key]: [where] } as never }),
          ).rejects.toThrow(AlephaError);
        }
        await expect(
          app.repository.findMany({ where: { not: where } as never }),
        ).rejects.toThrow(AlephaError);
      });

      it("should refuse an update and a delete, and leave every row", async ({
        expect,
      }) => {
        const app = await boot();
        await seed(app);

        await expect(
          app.repository.deleteMany({ id: { inArray: undefined } } as never),
        ).rejects.toThrow("'inArray: undefined'");
        await expect(
          app.repository.deleteMany({ name: { ne: null } } as never),
        ).rejects.toThrow("'ne: null'");
        await expect(
          app.repository.updateMany({ id: { inArray: undefined } } as never, {
            name: "overwritten",
          }),
        ).rejects.toThrow("'inArray: undefined'");
        expect(() =>
          app.repository.updateStatement(
            { id: { notInArray: undefined } } as never,
            { name: "overwritten" },
          ),
        ).toThrow(AlephaError);
        expect(() =>
          app.repository.deleteStatement({ rank: { lt: undefined } } as never),
        ).toThrow(AlephaError);

        const rows = await app.repository.findMany({ orderBy: "name" });
        expect(rows.map((it) => it.name)).toEqual(["archived", "live"]);
      });

      it("should throw in a subquery and in a relation filter", async ({
        expect,
      }) => {
        const app = await boot();
        await seed(app);

        expect(() =>
          app.repository.subquery({ rank: { gte: undefined } } as never, "id"),
        ).toThrow(AlephaError);
        expect(() =>
          app.repository.exists({ name: { contains: undefined } } as never),
        ).toThrow(AlephaError);
        await expect(
          app.related.findMany({
            where: { notes: { body: { contains: undefined } } } as never,
          }),
        ).rejects.toThrow("'contains: undefined'");
        await expect(
          app.related.findMany({
            where: { rank: { gt: null } } as never,
            include: { notes: true },
          }),
        ).rejects.toThrow("'gt: null'");
      });
    });
  });
}
