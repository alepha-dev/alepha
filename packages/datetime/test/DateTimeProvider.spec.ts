import { Alepha } from "@alepha/core";
import { describe, expect, it } from "vitest";
import { DateTimeProvider } from "../src";

describe("DateTimeProvider", () => {
	it("should pause time and reset", async () => {
		const app = Alepha.create();
		const dt = app.inject(DateTimeProvider);
		const clock = () => dt.nowISOString();

		const n1 = clock();
		await new Promise((resolve) => setTimeout(resolve, 10));

		dt.pause();
		const n2 = clock();

		expect(n1).not.toBe(n2);
		expect(n2).toBe(clock());
		expect(n2).toBe(clock());
		expect(n2).toBe(clock());

		dt.reset();
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(n2).not.toBe(clock());
	});

	it("should time travel and trigger scheduled callbacks", async () => {
		const stack: string[] = [];
		const app = Alepha.create();
		const dt = app.inject(DateTimeProvider);

		stack.push("A");

		dt.wait([10, "minutes"]).then(() => stack.push("B"));
		dt.wait([20, "minutes"]).then(() => stack.push("C"));

		expect(stack).toEqual(["A"]);

		await dt.travel([5, "minutes"]);

		expect(stack).toEqual(["A"]);

		await dt.travel([30, "minutes"]);

		expect(stack).toEqual(["A", "B", "C"]);
	});

	it("should handle timeouts with clearTimeout", async () => {
		const app = Alepha.create();
		const dt = app.inject(DateTimeProvider);
		const stack: string[] = [];

		dt.createTimeout(() => stack.push("A"), [10, "minutes"]);
		const n2 = dt.createTimeout(() => stack.push("B"), [10, "minutes"]);

		expect(stack).toEqual([]);

		await dt.travel([5, "minutes"]);
		expect(stack).toEqual([]);

		dt.clearTimeout(n2);

		await dt.travel([5, "minutes"]);
		expect(stack).toEqual(["A"]);
	});

	it("should wait with abort signal support", async () => {
		const app = Alepha.create();
		const dt = app.inject(DateTimeProvider);
		const stack: string[] = [];

		const abortController = new AbortController();
		dt.wait([10, "minutes"], { signal: abortController.signal }).then(() =>
			stack.push("A"),
		);

		expect(stack).toEqual([]);

		abortController.abort();

		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(stack).toEqual(["A"]);
	});
});
