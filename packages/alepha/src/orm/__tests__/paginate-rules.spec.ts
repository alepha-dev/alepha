import { $inject, Alepha, AlephaError, z } from "alepha";
import { describe, expect, it } from "vitest";

import {
  $entity,
  $relations,
  $repository,
  type DbTransaction,
  db,
} from "../core/index.ts";
import { DatabaseProvider } from "../core/providers/drivers/DatabaseProvider.ts";

/**
 * One paging rule for `Repository.paginate` and `RelationalRepository`
 * (#Q2670): the PageQuery is the only source of the page, its size is bounded,
 * `sort` beats the default `orderBy`; and relational reads take the statement
 * options that are safe on a join.
 */

const authors = $entity({
  name: "test_paginate_rules_authors",
  schema: z.object({
    id: db.primaryKey(z.integer(), {}, { mode: "byDefault" }),
    name: z.text(),
    deletedAt: db.deletedAt(),
  }),
});

const books = $entity({
  name: "test_paginate_rules_books",
  schema: z.object({
    id: db.primaryKey(z.integer(), {}, { mode: "byDefault" }),
    title: z.text(),
    authorId: db.ref(z.integer(), () => authors.cols.id),
  }),
});

const relations = $relations({ authors, books }, (r) => ({
  books: {
    author: r.one.authors({ from: r.books.authorId, to: r.authors.id }),
  },
}));

class App {
  authors = $repository(authors);
  relAuthors = $repository(relations, "authors");
  relBooks = $repository(relations, "books");
  db = $inject(DatabaseProvider);
}

const boot = async () => {
  const alepha = Alepha.create({
    env: { DATABASE_URL: "sqlite://:memory:" },
  });
  const app = alepha.inject(App);
  await alepha.start();
  for (const name of ["Cleo", "Ada", "Bea"]) {
    await app.authors.create({ name });
  }
  return app;
};

describe("paginate rules", () => {
  it("refuses limit or offset in the query, typed or not", async () => {
    const app = await boot();

    await expect(
      app.authors.paginate({}, { limit: 2 } as never),
    ).rejects.toThrow(/limit' or 'offset'/);
    await expect(
      app.relAuthors.paginate({}, { offset: 2 } as never),
    ).rejects.toThrow(/limit' or 'offset'/);
    // The relational engine's own path, taken when relations are included.
    await expect(
      app.relBooks.paginate({}, {
        offset: 2,
        include: { author: true },
      } as never),
    ).rejects.toThrow(/limit' or 'offset'/);
    await expect(
      app.relBooks.paginate({ size: 0 }, { include: { author: true } }),
    ).rejects.toThrow(/size must be/);
  });

  it("refuses a size outside [1, 100] and a negative page", async () => {
    const app = await boot();

    for (const pagination of [{ size: 0 }, { size: 101 }, { page: -1 }]) {
      await expect(app.authors.paginate(pagination)).rejects.toThrow(
        AlephaError,
      );
      await expect(app.relAuthors.paginate(pagination)).rejects.toThrow(
        AlephaError,
      );
    }
  });

  it("lets sort win over the query's default orderBy", async () => {
    const app = await boot();
    const orderBy = { column: "name", direction: "asc" } as const;

    const byDefault = await app.authors.paginate({}, { orderBy });
    expect(byDefault.content.map((it) => it.name)).toEqual([
      "Ada",
      "Bea",
      "Cleo",
    ]);

    const sorted = await app.authors.paginate({ sort: "-name" }, { orderBy });
    expect(sorted.content.map((it) => it.name)).toEqual(["Cleo", "Bea", "Ada"]);

    const relational = await app.relAuthors.paginate(
      { sort: "-name" },
      { orderBy, include: {} },
    );
    expect(relational.content.map((it) => it.name)).toEqual([
      "Cleo",
      "Bea",
      "Ada",
    ]);
  });
});

describe("relational statement options", () => {
  it("force reads soft-deleted rows, on findMany, paginate and count", async () => {
    const app = await boot();
    const [ada] = await app.authors.findMany({
      where: { name: { eq: "Ada" } },
    });
    await app.authors.deleteById(ada.id);

    expect(await app.relAuthors.findMany()).toHaveLength(2);
    expect(await app.relAuthors.findMany({}, { force: true })).toHaveLength(3);
    expect(await app.relAuthors.count({}, { force: true })).toBe(3);

    const page = await app.relAuthors.paginate(
      {},
      {},
      { force: true, count: true },
    );
    expect(page.page.totalElements).toBe(3);
  });

  it("reads in an explicit tx, through the relational engine too", async () => {
    const app = await boot();
    const author = await app.authors.findOne({
      where: { name: { eq: "Ada" } },
    });

    await app.authors.transaction(async (tx: DbTransaction) => {
      await app.relBooks.base.create({ title: "Notes", authorId: author!.id });

      const rows = await app.relBooks.findMany(
        { include: { author: true } },
        { tx },
      );
      expect(rows.map((it) => it.title)).toEqual(["Notes"]);
      expect(rows[0].author?.name).toBe("Ada");
    });
  });
});
