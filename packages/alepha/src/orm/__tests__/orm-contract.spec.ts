import { randomUUID } from "node:crypto";

import { $inject, Alepha, AlephaError, z } from "alepha";
import { describe, expect, it } from "vitest";

import {
  $entity,
  $repository,
  DbForeignKeyError,
  db,
  hasAttr,
  PG_REF,
} from "../core/index.ts";
import { DatabaseProvider } from "../core/providers/drivers/DatabaseProvider.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

/**
 * The ORM contract frozen by #Q2659: `db.*` helpers leave the schema they are
 * given alone and their attributes survive a later wrapper, `for` refuses a
 * cache it could not lock through, and a nested transaction refuses options
 * the outer one cannot honour.
 */
describe("db.* helpers", () => {
  it("leave a shared schema untouched", () => {
    const userId = z.uuid();
    const owners = $entity({
      name: "contract_shared_owners",
      schema: z.object({ id: db.primaryKey(z.uuid()) }),
    });

    const ref = db.ref(userId, () => owners.cols.id);

    expect(hasAttr(ref, PG_REF)).toBe(true);
    expect(hasAttr(userId, PG_REF)).toBe(false);
    expect(Object.getOwnPropertySymbols(userId)).toEqual([]);
  });

  describe("an attribute under a later wrapper", () => {
    const parents = $entity({
      name: "contract_parents",
      schema: z.object({
        id: db.primaryKey(z.uuid()),
        name: z.text(),
      }),
    });

    const children = $entity({
      name: "contract_children",
      schema: z.object({
        id: db.primaryKey(z.uuid()),
        // The order CLAUDE.md used to forbid: the reference was lost.
        parentId: db.ref(z.uuid(), () => parents.cols.id).optional(),
      }),
    });

    class App {
      parents = $repository(parents);
      children = $repository(children);
    }

    it("still makes a foreign key: an orphan insert is refused", async () => {
      const alepha = Alepha.create().with(AlephaOrmPostgres);
      const app = alepha.inject(App);
      await alepha.start();

      await expect(
        app.children.create({ parentId: randomUUID() }),
      ).rejects.toThrow(DbForeignKeyError);
    });

    it("defaults onDelete from the column as declared: set null", async () => {
      const alepha = Alepha.create().with(AlephaOrmPostgres);
      const app = alepha.inject(App);
      await alepha.start();

      const parent = await app.parents.create({ name: "p" });
      const child = await app.children.create({ parentId: parent.id });
      await app.parents.deleteById(parent.id);

      const after = await app.children.getById(child.id);
      expect(after.parentId).toBeUndefined();
    });
  });

  it("refuses an attribute hidden under a transform at registration", async () => {
    const targets = $entity({
      name: "contract_hidden_targets",
      schema: z.object({ id: db.primaryKey(z.uuid()) }),
    });
    const hidden = $entity({
      name: "contract_hidden",
      schema: z.object({
        id: db.primaryKey(z.uuid()),
        targetId: db
          .ref(z.uuid(), () => targets.cols.id)
          .transform((it) => it.toLowerCase()),
      }),
    });

    class App {
      targets = $repository(targets);
      hidden = $repository(hidden);
    }

    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:" },
    });
    expect(() => alepha.inject(App)).toThrow(
      /contract_hidden\.targetId.*Alepha\.Postgres\.Ref.*pipe/,
    );
  });
});

describe("row locks and the query cache", () => {
  const items = $entity({
    name: "contract_lock_items",
    schema: z.object({
      id: db.primaryKey(z.integer()),
      name: z.text(),
    }),
  });

  class App {
    items = $repository(items);
  }

  it("refuses `for` together with `cache`", async () => {
    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:" },
    });
    const app = alepha.inject(App);
    await alepha.start();

    await expect(
      app.items.findMany({}, { for: "update", cache: { ttl: 1000 } }),
    ).rejects.toThrow(AlephaError);
  });
});

describe("nested transactions", () => {
  class App {
    db = $inject(DatabaseProvider);
  }

  describe.each([
    {
      dialect: "postgres",
      create: () => Alepha.create().with(AlephaOrmPostgres),
    },
    {
      dialect: "sqlite",
      create: () =>
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    },
  ])("$dialect", ({ create }) => {
    it("joins with no options or the same ones", async () => {
      const alepha = create();
      const app = alepha.inject(App);
      await alepha.start();

      const result = await app.db.transactional(
        async () => {
          const bare = await app.db.transactional(async () => "bare");
          const same = await app.db.transactional(async () => "same", {
            isolation: "serializable",
          });
          return [bare, same];
        },
        { isolation: "serializable" },
      );
      expect(result).toEqual(["bare", "same"]);
    });

    it("refuses a different isolation", async () => {
      const alepha = create();
      const app = alepha.inject(App);
      await alepha.start();

      await expect(
        app.db.transactional(async () =>
          app.db.transactional(async () => "inner", {
            isolation: "serializable",
          }),
        ),
      ).rejects.toThrow(/isolation 'serializable'/);
    });

    it("refuses read write inside read only", async () => {
      const alepha = create();
      const app = alepha.inject(App);
      await alepha.start();

      await expect(
        app.db.transactional(
          async () =>
            app.db.transactional(async () => "inner", {
              access: "read write",
            }),
          { access: "read only" },
        ),
      ).rejects.toThrow(/read only/);
    });
  });
});
