import { $inject, Alepha, t } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { expect, test } from "vitest";
import {
	$repository,
	pg,
	pgTableSchema,
	type TransactionContext,
} from "../src";
import { VersionMismatchError } from "../src/errors/VersionMismatchError.ts";

class A {
	dt = $inject(DateTimeProvider);

	repository = $repository(
		pgTableSchema(
			"a",
			pg.entity({
				counter: t.int(),
				__v: pg.version(),
			}),
		),
	);

	incFn = async (
		id: number,
		val: number,
		waitMs = 0,
		tx?: TransactionContext,
	) => {
		const { counter } = await this.repository.findById(id, {
			tx,
		});

		if (waitMs) {
			await this.dt.wait(waitMs);
		}

		return await this.repository.updateById(
			id,
			{
				counter: counter + val,
			},
			{ tx },
		);
	};
}

test("version - basic", async () => {
	const alepha = Alepha.create();
	const app = alepha.get(A);
	await alepha.start();

	const { id } = await app.repository.save({ counter: 0 });
	const r1 = await app.repository.findById(id);
	const r2 = await app.repository.findById(id);

	r1.counter += 1;
	r2.counter += 1;

	await app.repository.save(r1);

	await expect(() => app.repository.save(r2)).rejects.toThrow(
		new VersionMismatchError("a", id),
	);
});
