import { expect, test } from "vitest";
import { Alepha, t } from "../src";

const model = t.object({
	id: t.string(),
	date: t.datetime(),
});

test("Alepha#parse", () => {
	const app = Alepha.create();
	const now = new Date();

	expect(
		app.parse(model, {
			id: "1",
			date: now.toISOString(),
		}),
	).toEqual({
		id: "1",
		date: now.toISOString(),
	});

	expect(
		app.parse(model, {
			id: "1",
			date: now.toISOString(),
		}),
	).toEqual({
		id: "1",
		date: now.toISOString(),
	});
});

test("Alepha#parse - cast", () => {
	const app = Alepha.create();
	expect(app.parse(t.number(), "1")).toBe(1);
});

test("Alepha#parse - array", () => {
	const app = Alepha.create();
	const now = new Date();
	const arrayModel = t.array(model);

	expect(
		app.parse(arrayModel, {
			id: "1",
			date: now.toISOString(),
		}),
	).toEqual([
		{
			id: "1",
			date: now.toISOString(),
		},
	]);

	expect(
		app.parse(arrayModel, [
			{
				id: "1",
				date: now.toISOString(),
			},
		]),
	).toEqual([
		{
			id: "1",
			date: now.toISOString(),
		},
	]);
});

test("Alepha#parse - unexpected", () => {
	const app = Alepha.create();

	expect(() => app.parse(t.string(), () => null)).toThrow(Error);
});

test("Alepha#parse - magic parsing", () => {
	const s = t.object({
		n: t.number(),
	});

	const app = Alepha.create();

	expect(app.parse(s, { n: "1" })).toEqual({ n: 1 });
	expect(app.parse(s, { n: 1 })).toEqual({ n: 1 });
	expect(app.parse(s, '{ "n": 3 }')).toEqual({ n: 3 });
	expect(app.parse(s, '{ "n": "1" }')).toEqual({ n: 1 });
	expect(app.parse(t.array(s), '{ "n": "2" }')).toEqual([{ n: 2 }]);
});
