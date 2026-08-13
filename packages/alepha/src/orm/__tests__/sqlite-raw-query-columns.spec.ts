import { Alepha, z } from "alepha";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { $entity, $repository, db } from "../core/index.ts";

/**
 * The `node:sqlite` driver shim rewrites every SELECT-with-JOIN to positional
 * aliases (`__c0`, `__c1`, …) so drizzle's `.raw()` path survives duplicate
 * column names. It did that inside `db.prepare`, i.e. for EVERY statement —
 * including a user's own `repository.query()`, which then came back keyed
 * `__c0…` instead of by the columns the query actually named.
 *
 * The aliasing belongs on the `.raw()` path only.
 */
const owners = $entity({
  name: "test_raw_owners",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    name: z.text(),
  }),
});

const pets = $entity({
  name: "test_raw_pets",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    name: z.text(),
    ownerId: db.ref(z.integer(), () => owners.cols.id),
  }),
});

class App {
  owners = $repository(owners);
  pets = $repository(pets);
}

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: "sqlite://:memory:" },
  });
  const app = alepha.inject(App);
  await alepha.start();
  const owner = await app.owners.create({ name: "Ada" });
  await app.pets.create({ name: "Rex", ownerId: owner.id });
  return { alepha, app };
};

describe("node:sqlite raw queries keep their column names", () => {
  it("returns a joined raw query keyed by the requested aliases", async () => {
    const { alepha, app } = await setup();

    const rows = await app.pets.query(
      sql`SELECT p.name AS pet, o.name AS owner
          FROM test_raw_pets p
          JOIN test_raw_owners o ON o.id = p.owner_id`,
      z.object({ pet: z.text(), owner: z.text() }),
    );

    expect(rows[0]).toMatchObject({ pet: "Rex", owner: "Ada" });
    expect(Object.keys(rows[0])).not.toContain("__c0");

    await alepha.stop();
  });

  it("keeps duplicate column names distinguishable when aliased", async () => {
    const { alepha, app } = await setup();

    const rows = await app.pets.query(
      sql`SELECT p.name AS "petName", o.name AS "ownerName"
          FROM test_raw_pets p
          JOIN test_raw_owners o ON o.id = p.owner_id`,
      z.object({ petName: z.text(), ownerName: z.text() }),
    );

    expect(rows[0].petName).toBe("Rex");
    expect(rows[0].ownerName).toBe("Ada");

    await alepha.stop();
  });

  it("still maps the ORM's own join correctly", async () => {
    const { alepha, app } = await setup();

    // The `.raw()` positional path is what the aliasing exists for; it must
    // keep working.
    const rows = await app.pets.findMany({
      with: { owner: { join: owners, on: ["ownerId", owners.cols.id] } },
    } as never);

    expect(rows[0]).toMatchObject({ name: "Rex" });

    await alepha.stop();
  });

  it("leaves a non-join raw query untouched", async () => {
    const { alepha, app } = await setup();

    const rows = await app.pets.query(
      sql`SELECT name FROM test_raw_pets`,
      z.object({ name: z.text() }),
    );

    expect(rows[0].name).toBe("Rex");

    await alepha.stop();
  });
});

describe("node:sqlite raw query with colliding column names", () => {
  it("does not rewrite the caller's columns to positional aliases", async () => {
    const { alepha, app } = await setup();

    // The precondition the shim's rewrite keys on: a JOIN whose column list
    // has duplicate BASE names. The rewrite is there for drizzle's `.raw()`
    // positional path, but it ran inside `db.prepare` — so a user's own query
    // came back keyed `__c0`, `__c1` instead of by its columns.
    const rows = await app.pets.query(
      sql`SELECT p.name, o.name
          FROM test_raw_pets p
          JOIN test_raw_owners o ON o.id = p.owner_id`,
      z.object({ name: z.text() }),
    );

    expect(Object.keys(rows[0]).join(",")).not.toContain("__c");

    await alepha.stop();
  });
});
