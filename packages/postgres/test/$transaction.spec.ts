import { $inject, Alepha, t } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { expect, test } from "vitest";
import { $repository, $transaction, pg, table } from "../src";
import { PgConflictError } from "../src/errors/PgConflictError.ts";

class App {
	dt = $inject(DateTimeProvider);

	repository = $repository(
		table(
			"a",
			pg.entity({
				v: pg.version(),
				counter: t.int(),
			}),
		),
	);

	inc = $transaction({
		handler: async (tx, id: number, val: number, waitMs = 0) => {
			const e = await this.repository.findById(id, {
				tx,
			});
			if (waitMs) {
				await this.dt.wait({ milliseconds: waitMs });
			}
			e.counter += val;
			return await this.repository.save(e, { tx });
		},
	});

	run = $transaction({
		handler: async (tx) => {
			await this.repository.deleteMany({}, { tx });
			const { id } = await this.repository.create({ counter: 0 }, { tx });
			await this.repository.create({ counter: 0 }, { tx });
			await this.repository.create({ counter: 0, id: id }, { tx });
		},
	});
}

const alepha = Alepha.create();
const app = alepha.get(App);

test("$transaction - mismatch", { timeout: 10000 }, async () => {
	const { id } = await app.repository.create({ counter: 0 });

	const tx = app.inc(id, 10, 200);
	await app.inc(id, 100);
	await tx;

	const r3 = await app.repository.findById(id);

	expect(r3.counter).toBe(110);
});

test("$transaction - rollback", { timeout: 10000 }, async () => {
	await app.repository.create({ counter: 0 });

	await expect(() => app.run()).rejects.toThrow(PgConflictError);

	expect(await app.repository.count()).toBe(1);
});
