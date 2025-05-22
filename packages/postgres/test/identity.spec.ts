import { Alepha, t } from "@alepha/core";
import { expect, test } from "vitest";
import { $repository, pg, pgTableSchema } from "../src";

class App {
	repository = $repository(
		pgTableSchema(
			"test",
			t.object({
				id: pg.primaryKey(pg.identity()),
				counter: t.int(),
			}),
		),
	);
}

test("identity - basic", async () => {
	const alepha = Alepha.create();
	const app = alepha.get(App);
	await alepha.start();

	expect(await app.repository.create({ counter: 1 })).toEqual({
		id: 1,
		counter: 1,
	});
});
