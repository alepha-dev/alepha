import { $inject, Alepha, t } from "@alepha/core";
import { expect, test } from "vitest";
import { $repository, pg, Repository, table } from "../src";
import { legacyIdSchema } from "../src/schemas/legacyIdSchema";

const testSchema = pg.entity({
	name: t.string(),
});

const testEntity = table("test", testSchema);

test("Repository - id serial", async () => {
	class App {
		repository = $repository(testEntity);
	}

	const alepha = Alepha.create();

	const app = alepha.get(App);

	await alepha.start();

	expect(app.repository.id.key).toEqual("id");
	expect(app.repository.id.type).toEqual(legacyIdSchema);

	const it = await app.repository.create({ name: "test" });

	expect(await app.repository.findById(it.id)).toEqual(it);
	expect(await app.repository.findById(String(it.id))).toEqual(it);

	const update = await app.repository.updateById(it.id, { name: "2" });

	expect(await app.repository.findById(it.id)).toEqual(update);

	await app.repository.deleteById(it.id);

	expect(await app.repository.count()).toBe(0);
});

test("Repository - id uuid (pglite)", async () => {
	const schema = t.object({
		uuid: pg.primaryKey(t.uuid()),
		name: t.string(),
	});
	const entity = table("test", schema);
	class App {
		repository = $repository(entity);
	}

	const alepha = Alepha.create();

	const app = alepha.get(App);

	await alepha.start();

	expect(app.repository.id.key).toEqual("uuid");
	expect(app.repository.id.type).toEqual(pg.primaryKey(t.uuid()));

	const it = await app.repository.create({ name: "test" });

	expect(await app.repository.findById(it.uuid)).toEqual(it);

	const update = await app.repository.updateById(it.uuid, { name: "2" });

	expect(await app.repository.findById(it.uuid)).toEqual(update);

	await app.repository.deleteById(it.uuid);

	expect(await app.repository.count()).toBe(0);
});

test("Repository - inject", async () => {
	class MyRepository extends Repository.of(testEntity) {
		findByName(name: string) {
			return this.findOne({
				name: {
					eq: name,
				},
			});
		}
	}

	class App {
		repository = $inject(MyRepository);
	}

	const alepha = Alepha.create();
	const app = alepha.get(App);
	await alepha.start();

	const it = await app.repository.create({ name: "test" });

	expect(await app.repository.findByName("test")).toEqual(it);
});
