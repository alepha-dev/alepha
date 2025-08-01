import { Alepha, t } from "@alepha/core";
import { expect, test } from "vitest";
import { $entity, $repository, PostgresProvider, pg } from "../src";
import { NodeSqliteProvider } from "../src/providers/drivers/NodeSqliteProvider.ts";

test("sqlite", async () => {
	const users = $entity({
		name: "users",
		schema: t.object({
			id: pg.primaryKey(t.int()),
			name: t.string(),
		}),
	});

	const alepha = Alepha.create().with({
		provide: PostgresProvider,
		use: NodeSqliteProvider,
	});

	class TestApp {
		userRepository = $repository(users);
	}

	const repository = alepha.inject(TestApp).userRepository;

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
