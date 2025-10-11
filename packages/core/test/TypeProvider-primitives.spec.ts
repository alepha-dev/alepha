import { expect, test } from "vitest";
import { Alepha, TypeBoxError, t } from "../src";

test("TypeProvider#int", () => {
	const a = Alepha.create();
	const m = t.int();

	expect(a.parse(m, 0)).toBe(0);
	expect(a.parse(m, 1.1)).toBe(1);
	expect(a.parse(m, "0")).toBe(0);
	expect(a.parse(m, 2147483647)).toBe(2147483647);
	expect(a.parse(m, -2147483647)).toBe(-2147483647);
	expect(() => a.parse(m, -2147483648)).toThrow(TypeBoxError);
	expect(() => a.parse(m, 2147483648)).toThrow(TypeBoxError);
});

test("TypeProvider#number", () => {
	const a = Alepha.create();
	const m = t.number();

	expect(a.parse(m, 0)).toBe(0);
	expect(a.parse(m, 1.1)).toBe(1.1);
	expect(a.parse(m, "0")).toBe(0);
	expect(() => a.parse(m, "a")).toThrow(TypeBoxError);
});

test("TypeProvider#boolean", () => {
	const a = Alepha.create();
	const m = t.boolean();

	expect(a.parse(m, true)).toBe(true);
	expect(a.parse(m, false)).toBe(false);
	expect(a.parse(m, 1)).toBe(true);
	expect(a.parse(m, 0)).toBe(false);
	expect(a.parse(m, "true")).toBe(true);
	expect(a.parse(m, "false")).toBe(false);
	expect(() => a.parse(m, "a")).toThrow(TypeBoxError);
});

test("TypeProvider#string", () => {
	const a = Alepha.create();
	const m = t.text();

	expect(a.parse(m, "a")).toBe("a");
	expect(a.parse(m, 1)).toBe("1");
	expect(a.parse(m, true)).toBe("true");
	expect(a.parse(m, false)).toBe("false");
	expect(() => a.parse(m, { hello: "world" })).toThrow(TypeBoxError);
});

test("TypeProvider#array", () => {
	const a = Alepha.create();
	const m = t.array(t.text());

	expect(a.parse(m, ["a", "b"])).toEqual(["a", "b"]);
	expect(a.parse(m, ["a", 1])).toEqual(["a", "1"]);
	expect(a.parse(m, [1])).toEqual(["1"]);
});

test("TypeProvider#enum", () => {
	const a = Alepha.create();
	const m = t.enum(["a", "b"]);

	expect(a.parse(m, "a")).toBe("a");
	expect(a.parse(m, "b")).toBe("b");
	expect(() => a.parse(m, "c")).toThrow(TypeBoxError);
});
