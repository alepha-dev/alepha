import { Alepha } from "@alepha/core";
import { expect, test } from "vitest";
import { DateTimeProvider } from "../src";

test("DateTimeProvider#pause", async () => {
	const app = Alepha.create();
	const dt = app.get(DateTimeProvider);
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

test("DateTimeProvider#add", async () => {
	const stack: string[] = [];
	const app = Alepha.create();
	const dt = app.get(DateTimeProvider);

	stack.push("A");

	dt.wait([10, "minutes"]).then(() => stack.push("B"));
	dt.wait([20, "minutes"]).then(() => stack.push("C"));

	expect(stack).toEqual(["A"]);

	await dt.travel([5, "minutes"]);

	expect(stack).toEqual(["A"]);

	await dt.travel([30, "minutes"]);

	expect(stack).toEqual(["A", "B", "C"]);
});

test("DateTimeProvider#timeout", async () => {
	const app = Alepha.create();
	const dt = app.get(DateTimeProvider);
	const stack: string[] = [];

	dt.timeout(() => stack.push("A"), [10, "minutes"]);
	const n2 = dt.timeout(() => stack.push("B"), [10, "minutes"]);

	expect(stack).toEqual([]);

	await dt.travel([5, "minutes"]);
	expect(stack).toEqual([]);

	n2.clear();

	await dt.travel([5, "minutes"]);
	expect(stack).toEqual(["A"]);
});
