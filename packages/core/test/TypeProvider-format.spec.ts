import { describe, expect, it } from "vitest";
import { Alepha, TypeBoxError, t } from "../src";

describe("TypeProvider format validation", () => {
	it("should validate datetime format", () => {
		const a = Alepha.create();
		const m = t.datetime();

		expect(a.parse(m, "2021-01-01T00:00:00Z")).toBe("2021-01-01T00:00:00Z");
		expect(() => a.parse(m, "2021-01-01")).toThrow(TypeBoxError);
	});

	it("should validate date format", () => {
		const a = Alepha.create();
		const m = t.date();

		expect(a.parse(m, "2021-01-01")).toBe("2021-01-01");
		expect(() => a.parse(m, "2021-01-01T00:00:00Z")).toThrow(TypeBoxError);
	});

	it("should validate uuid format", () => {
		const a = Alepha.create();
		const m = t.uuid();

		expect(a.parse(m, "550e8400-e29b-41d4-a716-446655440000")).toBe(
			"550e8400-e29b-41d4-a716-446655440000",
		);

		expect(() => a.parse(m, "550e8400-e29b-41d4-a716-44665544000")).toThrow(
			TypeBoxError,
		);
	});
});
