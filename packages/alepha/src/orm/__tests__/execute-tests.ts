import { type Alepha, SchemaValidationError, z } from "alepha";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { $entity, $repository, db, sql } from "../core/index.ts";

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
      (t) => sql`SELECT * FROM ${t} WHERE ${t.name} = ${name}`,
      userEntity.schema.pick({ name: true }),
    ),
  ).toEqual([
    {
      name,
    },
  ]);

  expect(
    await app.users.query(
      (t, db) => db.select({ name: t.name }).from(t).where(eq(t.name, name)),
      userEntity.schema.pick({ name: true }),
    ),
  ).toEqual([
    {
      name,
    },
  ]);

  expect(
    await app.users.query(
      (t) => sql`SELECT ${t.name} FROM ${t} WHERE ${t.name} = ${name}`,
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
      (t) => sql`SELECT ${t.name} FROM ${t} WHERE ${t.name} = ${name}`,
    ),
  ).rejects.toThrowError(SchemaValidationError);
};
