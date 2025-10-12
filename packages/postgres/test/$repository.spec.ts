import { Alepha, type Static } from "@alepha/core";
import { expect, test } from "vitest";
import { $repository } from "../src";
import { bigEntity } from "./fixtures/bigEntitySchema.ts";
import type { InsertUserEntity } from "./fixtures/userEntitySchema.ts";
import { userEntity } from "./fixtures/userEntitySchema.ts";

class App {
	users = $repository(userEntity);
	big = $repository(bigEntity);
	create = (data: InsertUserEntity) => this.users.create(data);
}

const testPgAttr = async (alepha: Alepha) => {
	const app = alepha.inject(App);
	await alepha.start();

	const entity = await app.users.create({
		suspect: "hey",
		name: "John",
		profile: {
			age: 30,
		},
	} as any);

	expect((entity as any).suspect).toBeUndefined();
	expect(entity.name).toEqual("John");
	expect(entity.profile.age).toEqual(30);
};

test("$repository - pg.attr", async () => {
	await testPgAttr(Alepha.create());
});

const testAllTypes = async (alepha: Alepha) => {
	const app = alepha.inject(App);
	await alepha.start();

	const data: Static<typeof bigEntity.$insertSchema> = {
		type: "big_entity",
		a: "a",
		b: 1.111,
		c: 2,
		d: true,
		e: {
			a: "a",
			b: 1,
			c: 2,
			d: true,
			e: {
				a: "a",
				b: 1,
				c: 2,
				d: true,
				j: [
					{
						a: "a",
						b: 1,
						c: 2,
						d: true,
						e: {
							a: "a",
							b: 1,
							c: 2,
							d: true,
						},
					},
				],
			},
		},
		f: ["a", "b"],
		g: [1.111],
		h: [2, 1],
		i: [true],
		j: [
			{
				a: "a",
				b: 1,
				c: 2,
				d: true,
				e: {
					a: "a",
					b: 1,
					c: 2,
					d: true,
				},
			},
		],
		k: new Date().toISOString(),
		l: "123e4567-e89b-12d3-a456-426614174000",
		m: "a" as const,
	};
	const entity = await app.big.create(data);

	expect(entity).toEqual({
		id: entity.id,
		...data,
	});

	const it = await app.big.find({
		where: {
			type: "big_entity",
		},
	});

	expect(it).toHaveLength(1);
};

test("$repository - all types", async () => {
	await testAllTypes(Alepha.create());
});
