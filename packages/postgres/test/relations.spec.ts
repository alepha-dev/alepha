import { Alepha, t } from "@alepha/core";
import { test } from "vitest";
import { $entity, $repository, pg } from "../src";

test("relations - many", async ({ expect }) => {
	const players = $entity({
		name: "players",
		schema: t.object({
			id: pg.primaryKey(t.int()),
			userId: pg.ref(t.int(), () => users.id),
			score: t.int(),
		}),
	});

	const addresses = $entity({
		name: "addresses",
		schema: t.object({
			id: pg.primaryKey(t.int()),
			userId: pg.ref(t.int(), () => users.id),
			city: t.text(),
		}),
	});

	const users = $entity({
		name: "users",
		schema: t.object({
			id: pg.primaryKey(t.int()),
			name: t.text(),
			players: pg.many(players, "userId"),
			address: pg.one(addresses, "userId"),
		}),
	});

	class Db {
		users = $repository(users);
		players = $repository(players);
		addresses = $repository(addresses);
	}

	const alepha = Alepha.create();
	const db = alepha.inject(Db);

	await alepha.start();

	const john = await db.users.create({ name: "John" });
	await db.users.create({ name: "John2" });
	await db.players.create({ userId: john.id, score: 100 });
	await db.addresses.create({ userId: john.id, city: "New York" });

	const results = await db.users.find({
		relations: {
			players: true,
		},
	});

	expect(results[0].players).toHaveLength(1);
	expect(results[0].players?.[0].score).toBe(100);

	const results2 = await db.users.find({
		where: {
			players: {
				score: 100,
			},
		},
	});

	expect(results2).toHaveLength(1);
	expect(results2[0].id).toBe(john.id);

	const results3 = await db.users.find({
		relations: {
			address: true,
		},
	});

	expect(results3[0]?.address?.city).toBe("New York");
});
