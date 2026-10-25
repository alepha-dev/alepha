import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import { $entity, $relations, $repository, db } from "../core/index.ts";

const authors = $entity({
  name: "test_rqb_guard_authors",
  schema: z.object({
    id: db.primaryKey(z.integer(), {}, { mode: "byDefault" }),
    name: z.text(),
  }),
});

const posts = $entity({
  name: "test_rqb_guard_posts",
  schema: z.object({
    id: db.primaryKey(z.integer(), {}, { mode: "byDefault" }),
    title: z.text(),
    authorId: db.ref(z.integer(), () => authors.cols.id),
  }),
});

const relations = $relations({ authors, posts }, (r) => ({
  posts: {
    author: r.one.authors({ from: r.posts.authorId, to: r.authors.id }),
  },
}));

class App {
  authors = $repository(relations, "authors");
  posts = $repository(relations, "posts");
}

const boot = async () => {
  const alepha = Alepha.create({
    env: { DATABASE_URL: "sqlite://:memory:" },
  });
  const app = alepha.inject(App);
  await alepha.start();

  const author = await app.authors.create({ data: { name: "ann" } });
  for (const title of ["a", "b", "c"]) {
    await app.posts.create({ data: { title, authorId: author.id } });
  }
  return app;
};

describe("relational queries on sqlite", () => {
  it("accepts an offset without a limit", async () => {
    // SQLite rejects OFFSET without LIMIT; the plain repository already
    // injects an unbounded limit and the relational path has to as well.
    const app = await boot();

    const rows = await app.posts.findMany({
      include: { author: true },
      orderBy: "title",
      offset: 1,
    });

    expect(rows.map((r) => r.title)).toEqual(["b", "c"]);
    expect(rows[0]?.author?.name).toBe("ann");
  });

  it("rejects an unknown column with the framework's error", async () => {
    // Used to compile to `WHERE  = ?` and surface as an opaque driver error.
    const app = await boot();

    await expect(
      app.posts.findMany({
        include: { author: true },
        where: { nope: { eq: 1 } } as any,
      }),
    ).rejects.toThrow(/Column 'nope' not found/);
  });

  it("rejects a null relation filter and does not run unfiltered", async () => {
    // The column path already refuses `null` and `undefined` because either
    // one silently drops the condition. This branch used to `continue` on
    // undefined and answer null with a message about object shape, so the
    // identical mistake one key over got two different answers, one silent.
    const app = await boot();

    await expect(
      app.posts.findMany({ where: { author: null } as any }),
    ).rejects.toThrow(/is null/);
  });

  it("rejects an undefined relation filter", async () => {
    const app = await boot();

    await expect(
      app.posts.findMany({
        include: { author: true },
        where: { author: undefined } as any,
      }),
    ).rejects.toThrow(/is undefined/);
  });
});
