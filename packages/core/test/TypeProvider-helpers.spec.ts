import { describe, expect, it } from "vitest";
import { Alepha, TypeBoxError, t } from "../src";

describe("TypeProvider", () => {
	it("should handle optional fields", () => {
		const a = Alepha.create();
		const m = t.object({
			a: t.optional(t.text()),
		});

		expect(a.parse(m, {})).toEqual({});
		expect(a.parse(m, { a: 1 })).toEqual({ a: "1" });
		expect(a.parse(m, { a: undefined })).toEqual({});
		//expect(() => a.parse(m, { a: null })).toThrow(TypeBoxError);
	});

	it("should handle snake_case fields", () => {
		const a = Alepha.create();
		const m = t.object({
			foo_bar: t.text(),
		});

		expect(a.parse(m, { foo_bar: "hello" })).toEqual({ foo_bar: "hello" });
		expect(() => a.parse(m, { fooBar: "hello" })).toThrow(TypeBoxError);
	});
});
