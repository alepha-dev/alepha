import { $inject, Alepha, t } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { expect, test } from "vitest";
import { $entity, $repository, $transaction, pg } from "../src";
import { PgConflictError } from "../src/errors/PgConflictError.ts";

const a = $entity({
	name: "a",
	schema: t.object({
		id: pg.primaryKey(
			t.int(),
			{},
			{
				mode: "byDefault",
			},
		),
		v: pg.version(),
		counter: t.int(),
	}),
});

class App {
	dt = $inject(DateTimeProvider);

	repository = $repository(a);

	runIncrementTest = $transaction({
		handler: async (tx, id: number, val: number, waitMs = 0) => {
			const e = await this.repository.findById(id, {
				tx,
			});
			if (waitMs) {
				await this.dt.wait(waitMs);
			}
			e.counter += val;
			return await this.repository.save(e, { tx });
		},
	});

	runCollisionTest = $transaction({
		handler: async (tx) => {
			await this.repository.deleteMany({}, { tx });
			const { id } = await this.repository.create({ counter: 0 }, { tx });
			await this.repository.create({ counter: 0 }, { tx });
			await this.repository.create({ counter: 0, id: id }, { tx });
		},
	});
}

test("$transaction - mismatch", { timeout: 10000 }, async () => {
	const alepha = Alepha.create();
	const app = alepha.inject(App);
	await alepha.start();

	const { id } = await app.repository.create({ counter: 0 });

	const tx = app.runIncrementTest(id, 10, 200);
	await app.runIncrementTest(id, 100);
	await tx;

	const r3 = await app.repository.findById(id);

	expect(r3.counter).toBe(110);
});

test("$transaction - rollback", { timeout: 10000 }, async () => {
	const alepha = Alepha.create();
	const app = alepha.inject(App);
	await alepha.start();

	await app.repository.create({ counter: 0 });

	await expect(() => app.runCollisionTest()).rejects.toThrow(PgConflictError);

	expect(await app.repository.count()).toBe(1);
});
