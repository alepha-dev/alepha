import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";
import { $entity, $repository, db } from "../core/index.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

const items = $entity({
  name: "test_query_guard_items",
  schema: z.object({
    id: db.primaryKey(),
    name: z.text(),
    tags: z.array(z.text()),
  }),
});

class App {
  repository = $repository(items);
}

describe("text primary keys", () => {
  it("should support a non-uuid text primary key", async () => {
    // The overload accepted any string schema but only handled
    // `format: "uuid"`, throwing "Unsupported type for primary key" for the
    // rest — so a slug PK compiled and then crashed at startup.
    const slugged = $entity({
      name: "test_slug_pk",
      schema: z.object({
        id: db.primaryKey(z.text()),
        label: z.text(),
      }),
    });

    class SlugApp {
      repository = $repository(slugged);
    }

    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:" },
    });
    const app = alepha.inject(SlugApp);
    await alepha.start();

    await app.repository.create({ id: "hello-world", label: "Hello" });
    const found = await app.repository.findMany();

    expect(found.map((it) => it.id)).toEqual(["hello-world"]);
  });
});

describe("query guards", () => {
  describe("mistyped operators", () => {
    it("should reject `in` and point at `inArray`", async () => {
      // `{ in: [...] }` has no recognised operator key, so it fell through to
      // the direct-value branch and produced eq(column, <object>) — a query
      // that silently matches nothing.
      const alepha = Alepha.create({
        env: { DATABASE_URL: "sqlite://:memory:" },
      });
      const app = alepha.inject(App);
      await alepha.start();

      await expect(
        app.repository.findMany({
          where: { name: { in: ["a", "b"] } as any },
        }),
      ).rejects.toThrow(/inArray/);
    });

    it("should not reject an object that is merely unrecognised", async () => {
      // The guard is deliberately narrow: only known aliases of real
      // operators are rejected. A plain object is a legitimate equality value
      // for a JSON column, so an unrecognised key must fall through to the
      // driver rather than be second-guessed here.
      const alepha = Alepha.create({
        env: { DATABASE_URL: "sqlite://:memory:" },
      });
      const app = alepha.inject(App);
      await alepha.start();

      const error = await app.repository
        .findMany({ where: { name: { some: "thing" } as any } })
        .catch((e) => e);

      // It still fails — comparing a TEXT column to an object cannot work —
      // but with the driver's error, not ours.
      expect(String(error)).not.toMatch(/unknown operator/i);
    });
  });

  describe("array operators on sqlite", () => {
    it("should refuse arrayContains instead of emitting invalid SQL", async () => {
      // These map to postgres array functions; sqlite/D1 stores arrays as
      // JSON text, so they produced invalid SQL or wrong semantics.
      const alepha = Alepha.create({
        env: { DATABASE_URL: "sqlite://:memory:" },
      });
      const app = alepha.inject(App);
      await alepha.start();

      await expect(
        app.repository.findMany({
          where: { tags: { arrayContains: ["x"] } as any },
        }),
      ).rejects.toThrow(/not supported on sqlite/i);
    });

    it("should still allow arrayContains on postgres", async () => {
      const alepha = Alepha.create().with(AlephaOrmPostgres);
      const app = alepha.inject(App);
      await alepha.start();

      await expect(
        app.repository.findMany({
          where: { tags: { arrayContains: ["x"] } as any },
        }),
      ).resolves.toBeDefined();
    });
  });
});

describe("text primary key insert schema", () => {
  it("should require the id — a slug PK has no server-side default", async () => {
    // `PG_DEFAULT` marks a column the database fills in, and `insertSchema`
    // turns every such column optional. A uuid PK earns it (the DB generates
    // one) and an integer PK earns it (identity); a plain text PK does not —
    // there is nothing to generate, so omitting it must not typecheck and
    // must not reach the driver as a NULL primary key.
    const slugged = $entity({
      name: "test_slug_pk_required",
      schema: z.object({
        id: db.primaryKey(z.text()),
        label: z.text(),
      }),
    });

    class SlugApp {
      repository = $repository(slugged);
    }

    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:" },
    });
    const app = alepha.inject(SlugApp);
    await alepha.start();

    // The insert schema is what makes `id` optional at the call site, so
    // assert on it directly: a runtime NOT NULL violation is the symptom, but
    // the point of the framework is that this never compiles.
    expect(z.schema.requiredKeys(slugged.insertSchema)).toContain("id");

    await expect(
      app.repository.create({ label: "Hello" } as any),
    ).rejects.toThrow();
  });
});
