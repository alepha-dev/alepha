import { Alepha, t } from "@alepha/core";
import { expect, test } from "vitest";
import { $entity, PostgresProvider, pg, Repository } from "../src";
import { NodeSqliteProvider } from "../src/providers/drivers/NodeSqliteProvider.ts";

test("sqlite", async () => {
	const users = $entity({
		name: "users",
		schema: t.object({
			id: pg.primaryKey(),
			name: t.string(),
		}),
	});

	class UserRepository extends Repository.of(users) {}

	const alepha = Alepha.create().with({
		provide: PostgresProvider,
		use: NodeSqliteProvider,
	});

	const repository = alepha.inject(UserRepository);

	await alepha.start();

	await repository.create({
		name: "John Doe",
	});

	const user = await repository.findOne({
		name: { eq: "John Doe" },
	});

	expect(user).toStrictEqual({
		id: 1,
		name: "John Doe",
	});
});
