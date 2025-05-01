import { Alepha } from "@alepha/core";
import { expect, test } from "vitest";
import { CatCtrl, ColorCtrl } from "./fixtures/CatWorld";

test("$route - query", async () => {
	const app = Alepha.create();
	const catCtrl = app.get(CatCtrl);
	await app.start();

	expect(await catCtrl.cats()).toEqual(catCtrl.data);

	expect(
		await catCtrl.cats({
			query: { name: "Tom" },
		}),
	).toEqual([catCtrl.data[0]]);

	await app.stop();
});

test("$route - body", async () => {
	const app = Alepha.create({
		env: {
			COLOR: "black",
		},
	});
	const catCtrl = app.with(ColorCtrl).get(CatCtrl);
	await app.start();

	const newCat = { name: "Mickey" };

	expect(await catCtrl.newCat({ body: newCat })).toEqual({
		name: newCat.name,
		color: "black",
	});

	expect(await catCtrl.cats()).toHaveLength(3);
});

test("$route - params", async () => {
	const app = Alepha.create({
		env: {
			COLOR: "black",
		},
	});
	const catCtrl = app.with(ColorCtrl).get(CatCtrl);
	await app.start();

	expect(await catCtrl.oneCat({ params: { name: "Tom" } })).toEqual(
		catCtrl.data[0],
	);
});
