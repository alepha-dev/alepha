import { expect, test } from "vitest";
import { Alepha, TypeBoxError, t } from "../src";

test("TypeProvider#map", () => {
	const user = t.object({
		id: t.string(),
		name: t.string(),
		age: t.int(),
	});

	const userCreate = t.map(user, {
		omit: ["id"],
		optional: ["age"],
	});

	const app = Alepha.create();
	expect(
		app.parse(userCreate, {
			id: "1",
			name: "John",
		}),
	).toEqual({
		name: "John",
	});
});

test("TypeProvider#optional", () => {
	const a = Alepha.create();
	const m = t.object({
		a: t.optional(t.string()),
	});

	expect(a.parse(m, {})).toEqual({});
	expect(a.parse(m, { a: 1 })).toEqual({ a: "1" });
	expect(a.parse(m, { a: undefined })).toEqual({});
	expect(() => a.parse(m, { a: null })).toThrow(TypeBoxError);
});

test("TypeProvider#nullable", () => {
	const a = Alepha.create();
	const m = t.nullify(
		t.object({
			a: t.string(),
		}),
	);

	expect(() => a.parse(m, {})).toThrow(TypeBoxError);
	expect(a.parse(m, { a: 1 })).toEqual({ a: "1" });
	expect(a.parse(m, { a: null })).toEqual({ a: null });
	expect(() => a.parse(m, { a: undefined })).toThrow(TypeBoxError);
});

test("TypeProvider#snake_case", () => {
	const a = Alepha.create();
	const m = t.object({
		foo_bar: t.string(),
	});

	expect(a.parse(m, { foo_bar: "hello" })).toEqual({ foo_bar: "hello" });
	expect(() => a.parse(m, { fooBar: "hello" })).toThrow(TypeBoxError);
});
