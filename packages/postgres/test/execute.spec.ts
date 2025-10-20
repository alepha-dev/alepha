import { Alepha, TypeBoxError, t } from "@alepha/core";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { $entity, $repository, pg, sql } from "../src";

describe("execute", () => {
  it("should execute basic SQL queries", async () => {
    const userEntity = $entity({
      name: "users",
      schema: t.object({
        id: pg.primaryKey(t.int64()),
        name: t.text(),
        guildId: t.optional(t.int()),
      }),
      indexes: [{ column: "name", unique: true }],
    });

    class App {
      users = $repository(userEntity);
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);

    await alepha.start();

    const name = "Alepha";
    await app.users.create({
      name,
    });

    expect(
      await app.users.query(
        (t) => sql`SELECT * FROM ${t} WHERE ${t.name} = ${name}`,
        t.pick(userEntity.$schema, ["name"]),
      ),
    ).toEqual([
      {
        name,
      },
    ]);

    expect(
      await app.users.query(
        (t, db) => db.select({ name: t.name }).from(t).where(eq(t.name, name)),
        t.pick(userEntity.$schema, ["name"]),
      ),
    ).toEqual([
      {
        name,
      },
    ]);

    expect(
      await app.users.query(
        (t) => sql`SELECT ${t.name} FROM ${t} WHERE ${t.name} = ${name}`,
        t.pick(userEntity.$schema, ["name"]),
      ),
    ).toEqual([
      {
        name,
      },
    ]);

    // by default execute expects a full schema, so this should throw
    await expect(() =>
      app.users.query(
        (t) => sql`SELECT ${t.name} FROM ${t} WHERE ${t.name} = ${name}`,
      ),
    ).rejects.toThrowError(TypeBoxError);
  });
});
