import { type Alepha, SchemaValidationError, z } from "alepha";
import { expect } from "vitest";

import { $entity, $repository, db, sql } from "../core/index.ts";
import { Drizzle, eq } from "../drizzle/index.ts";

const userEntity = $entity({
  name: "users",
  schema: z.object({
    id: db.primaryKey(z.int64()),
    name: z.text(),
    guildId: z.integer().optional(),
  }),
  indexes: [{ column: "name", unique: true }],
});

class App {
  users = $repository(userEntity);
}

export const testExecuteBasicSqlQueries = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  const name = "Alepha";
  await app.users.create({
    name,
  });

  expect(
    await app.users.query(
      sql`SELECT * FROM ${app.users.table} WHERE ${app.users.table.name} = ${name}`,
      userEntity.schema.pick({ name: true }),
    ),
  ).toEqual([
    {
      name,
    },
  ]);

  expect(
    await app.users.query(
      Drizzle.db(app.users)
        .select({ name: Drizzle.table(app.users).name })
        .from(Drizzle.table(app.users))
        .where(eq(Drizzle.table(app.users).name, name))
        .getSQL(),
      userEntity.schema.pick({ name: true }),
    ),
  ).toEqual([
    {
      name,
    },
  ]);

  expect(
    await app.users.query(
      sql`SELECT ${app.users.table.name} FROM ${app.users.table} WHERE ${app.users.table.name} = ${name}`,
      userEntity.schema.pick({ name: true }),
    ),
  ).toEqual([
    {
      name,
    },
  ]);

  // by default execute expects a full schema, so this should throw
  await expect(() =>
    app.users.query(
      sql`SELECT ${app.users.table.name} FROM ${app.users.table} WHERE ${app.users.table.name} = ${name}`,
    ),
  ).rejects.toThrow(SchemaValidationError);
};
