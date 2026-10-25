import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import {
  $entity,
  $relations,
  $repository,
  db,
  DbEntityNotFoundError,
} from "../core/index.ts";

const authors = $entity({
  name: "test_rqb_nf_authors",
  schema: z.object({
    id: db.primaryKey(z.integer(), {}, { mode: "byDefault" }),
    name: z.text(),
  }),
});

const posts = $entity({
  name: "test_rqb_nf_posts",
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
  return app;
};

describe("relational repository, no match", () => {
  it("getOne throws DbEntityNotFoundError, a 404 like the plain repository", async () => {
    const app = await boot();

    const error = await app.posts
      .getOne({
        where: { title: { eq: "missing" } },
        include: { author: true },
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DbEntityNotFoundError);
    expect((error as DbEntityNotFoundError).status).toBe(404);
  });

  it("getById throws DbEntityNotFoundError", async () => {
    const app = await boot();

    await expect(app.posts.getById(42)).rejects.toThrow(DbEntityNotFoundError);
  });

  it("the plain repository behind it throws the same error", async () => {
    const app = await boot();

    await expect(
      app.posts.base.getOne({ where: { title: { eq: "missing" } } }),
    ).rejects.toThrow(DbEntityNotFoundError);
  });
});
