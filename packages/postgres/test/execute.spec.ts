import { Alepha, TypeBoxError, t } from "@alepha/core";
import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { $entity, $repository, pg, sql } from "../src";

const userEntity = $entity({
	name: "users",
	schema: t.object({
		id: pg.primaryKey(),
		name: t.string(),
		guildId: t.optional(t.int()),
	}),
	indexes: [{ column: "name", unique: true }],
});

class App {
	users = $repository(userEntity);
}

const alepha = Alepha.create();
const app = alepha.get(App);

test("execute - basic", async () => {
	const name = "Alepha";
	await app.users.create({
		name,
	});

	expect(
		await app.users.execute(
			(u) => sql`SELECT * FROM ${u} WHERE ${u.name} = ${name}`,
			t.pick(userEntity.$schema, ["name"]),
		),
	).toEqual([
		{
			name,
		},
	]);

	expect(
		await app.users.execute(
			(u, db) => db.select({ name: u.name }).from(u).where(eq(u.name, name)),
			t.pick(userEntity.$schema, ["name"]),
		),
	).toEqual([
		{
			name,
		},
	]);

	expect(
		await app.users.execute(
			(u) => sql`SELECT ${u.name} FROM ${u} WHERE ${u.name} = ${name}`,
			t.pick(userEntity.$schema, ["name"]),
		),
	).toEqual([
		{
			name,
		},
	]);

	// by default execute expects a full schema, so this should throw
	await expect(() =>
		app.users.execute(
			(u) => sql`SELECT ${u.name} FROM ${u} WHERE ${u.name} = ${name}`,
		),
	).rejects.toThrowError(TypeBoxError);
});
