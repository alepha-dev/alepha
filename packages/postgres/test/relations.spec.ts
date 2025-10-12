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

	const users = $entity({
		name: "users",
		schema: t.object({
			id: pg.primaryKey(t.int()),
			name: t.text(),
			players: pg.many(players, "userId"),
		}),
	});

	class Db {
		users = $repository(users);
		players = $repository(players);
	}

	const alepha = Alepha.create();
	const db = alepha.inject(Db);

	await alepha.start();

	const john = await db.users.create({ name: "John" });
	await db.users.create({ name: "John2" });
	await db.players.create({ userId: john.id, score: 100 });

	// Test 1: Find with relations and relation filter
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
});
