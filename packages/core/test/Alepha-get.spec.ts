import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { Alepha } from "../src";

test("Alepha#get - skip registration", () => {
	class Logger {
		a = randomUUID();
	}

	const alepha = new Alepha();

	expect(alepha.get(Logger, { skipRegistration: true }).a).not.toBe(
		alepha.get(Logger, { skipRegistration: true }).a,
	);

	expect(alepha.get(Logger).a).toBe(alepha.get(Logger).a);

	expect(alepha.get(Logger, { skipRegistration: true }).a).toBe(
		alepha.get(Logger, { skipRegistration: true }).a,
	);

	expect(
		alepha.get(Logger, { skipRegistration: true, skipCache: true }).a,
	).not.toBe(alepha.get(Logger, { skipRegistration: true, skipCache: true }).a);
});

test("Alepha#get - args", () => {
	class Logger {
		constructor(public a: string) {}
	}

	const alepha = new Alepha();

	expect(alepha.get(Logger, { args: ["a"] }).a).toBe("a");
	expect(alepha.get(Logger).a).toBe("a");
});

test("Alepha#get - alepha", () => {
	const alepha = new Alepha();

	expect(alepha.get(Alepha)).toBe(alepha);
});
