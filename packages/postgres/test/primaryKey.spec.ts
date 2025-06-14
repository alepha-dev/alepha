import { Alepha, t } from "@alepha/core";
import { expect, test } from "vitest";
import { $entity, $repository, pg } from "../src";
import { PgError } from "../src/errors/PgError.ts";

class App {
	identity = $repository(
		$entity({
			name: "identity",
			schema: t.object({
				id: pg.primaryKey(),
			}),
		}),
	);

	big = $repository(
		$entity({
			name: "big",
			schema: t.object({
				id: pg.bigIdentityPrimaryKey(),
			}),
		}),
	);

	uuid = $repository(
		$entity({
			name: "uuid",
			schema: t.object({
				id: pg.uuidPrimaryKey(),
			}),
		}),
	);
}

test("primaryKey - identity", async () => {
	class App {
		identity = $repository(
			$entity({
				name: "identity",
				schema: t.object({
					id: pg.identityPrimaryKey({
						mode: "always",
						minValue: 2147483646,
					}),
				}),
			}),
		);
	}

	const alepha = Alepha.create();
	const app = alepha.get(App);
	await alepha.start();

	expect(await app.identity.create({})).toEqual({
		id: 2147483646,
	});

	await app.identity.create({});

	await expect(() => app.identity.create({})).rejects.toThrowError(PgError);
});

test("primaryKey - big identity", async () => {
	class App {
		big = $repository(
			$entity({
				name: "big",
				schema: t.object({
					id: pg.bigIdentityPrimaryKey({
						mode: "always",
						minValue: 2147483646,
					}),
				}),
			}),
		);
	}

	const alepha = Alepha.create();
	const app = alepha.get(App);
	await alepha.start();

	expect(await app.big.create({})).toEqual({
		id: 2147483646,
	});

	expect(await app.big.create({})).toEqual({
		id: 2147483647,
	});

	expect(await app.big.create({})).toEqual({
		id: 2147483648,
	});
});

test("primaryKey - uuid", async () => {
	class App {
		uuid = $repository(
			$entity({
				name: "uuid",
				schema: t.object({
					id: pg.uuidPrimaryKey(),
				}),
			}),
		);
	}

	const alepha = Alepha.create();
	const app = alepha.get(App);
	await alepha.start();

	expect(await app.uuid.create({})).toEqual({
		id: expect.any(String),
	});
});
