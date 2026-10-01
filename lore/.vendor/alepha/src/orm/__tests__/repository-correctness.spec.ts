import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import { $entity, $repository, db } from "../core/index.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

/**
 * Four correctness findings from the framework review, each verified against
 * a real database rather than reasoned about.
 */
const authors = $entity({
  name: "test_corr_authors",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    updatedAt: db.updatedAt(),
    deletedAt: db.deletedAt(),
    name: z.text(),
  }),
});

const books = $entity({
  name: "test_corr_books",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    title: z.text(),
    authorId: db.ref(z.integer(), () => authors.cols.id),
  }),
});

const contacts = $entity({
  name: "test_corr_contacts",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    email: z.text(),
    nickname: z.text().optional(),
  }),
  indexes: [{ columns: ["email"], unique: true }],
});

class App {
  authors = $repository(authors);
  books = $repository(books);
  contacts = $repository(contacts);
}

const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } }).with(
    AlephaOrmPostgres,
  );
  const app = alepha.inject(App);
  await alepha.start();
  return { alepha, app };
};

describe("distinct combined with joins", () => {
  it("refuses the combination instead of returning garbage", async () => {
    const { alepha, app } = await setup();

    // `rawSelectDistinct` selects a flat field map while join post-processing
    // expects drizzle's nested per-table row shape, so `row[tableName]` is
    // undefined and the mapping silently produces junk.
    await expect(
      app.books.findMany({
        distinct: ["title"],
        with: {
          author: { join: authors, on: ["authorId", authors.cols.id] },
        },
      } as never),
    ).rejects.toThrow(/distinct/i);

    await alepha.stop();
  });

  it("still allows distinct on its own", async () => {
    const { alepha, app } = await setup();
    const author = await app.authors.create({ name: "Ada" });
    await app.books.createMany([
      { title: "A", authorId: author.id },
      { title: "A", authorId: author.id },
      { title: "B", authorId: author.id },
    ]);

    const rows = await app.books.findMany({ distinct: ["title"] });
    expect(rows).toHaveLength(2);

    await alepha.stop();
  });

  it("still allows joins on their own", async () => {
    const { alepha, app } = await setup();
    const author = await app.authors.create({ name: "Ada" });
    await app.books.create({ title: "A", authorId: author.id });

    const rows = await app.books.findMany({
      with: { author: { join: authors, on: ["authorId", authors.cols.id] } },
    } as never);
    expect(rows[0]).toMatchObject({ title: "A" });

    await alepha.stop();
  });
});

describe("callers' objects are not mutated", () => {
  it("updateMany does not stamp updatedAt onto the caller's data", async () => {
    const { alepha, app } = await setup();
    await app.authors.create({ name: "Ada" });

    const patch = { name: "Grace" };
    await app.authors.updateMany({ name: { eq: "Ada" } }, patch);

    // A reused patch object would otherwise carry a stale updatedAt into the
    // next call.
    expect(Object.keys(patch)).toEqual(["name"]);

    await alepha.stop();
  });

  it("destroy DOES stamp deletedAt onto the caller's entity, deliberately", async () => {
    const { alepha, app } = await setup();
    const author = await app.authors.create({ name: "Ada" });

    await app.authors.destroy(author);

    // Not a stray mutation: it keeps the in-memory object consistent with the
    // row, so a later `save(entity, { force: true })` writes the soft-delete
    // back rather than nulling it and resurrecting the row.
    expect((author as Record<string, unknown>).deletedAt).toBeTruthy();

    await alepha.stop();
  });
});

describe("upsert without an updatedAt column", () => {
  it("survives a SET clause that would otherwise be empty", async () => {
    const { alepha, app } = await setup();

    // The default SET removes the conflict target and the PK. When the target
    // is the ONLY field supplied and the entity has no PG_UPDATED_AT, that
    // leaves `{}` — which drizzle cannot render.
    await app.contacts.upsert(
      { email: "a@example.com" },
      { target: ["email"] },
    );

    const again = await app.contacts.upsert(
      { email: "a@example.com" },
      { target: ["email"] },
    );

    expect(again.email).toBe("a@example.com");

    const all = await app.contacts.findMany({});
    expect(all).toHaveLength(1);

    await alepha.stop();
  });

  it("still updates the other columns when they are supplied", async () => {
    const { alepha, app } = await setup();

    await app.contacts.upsert(
      { email: "b@example.com", nickname: "first" },
      { target: ["email"] },
    );
    const again = await app.contacts.upsert(
      { email: "b@example.com", nickname: "second" },
      { target: ["email"] },
    );

    expect(again.nickname).toBe("second");

    await alepha.stop();
  });
});
