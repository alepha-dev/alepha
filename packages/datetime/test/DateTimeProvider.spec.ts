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

	dt.wait({ minutes: 10 }).then(() => stack.push("B"));
	dt.wait({ minutes: 20 }).then(() => stack.push("C"));

	expect(stack).toEqual(["A"]);

	await dt.add({ minutes: 5 });

	expect(stack).toEqual(["A"]);

	await dt.add({ minutes: 30 });

	expect(stack).toEqual(["A", "B", "C"]);
});

test("DateTimeProvider#timeout", async () => {
	const app = Alepha.create();
	const dt = app.get(DateTimeProvider);
	const stack: string[] = [];

	dt.timeout(() => stack.push("A"), { minutes: 10 });
	const n2 = dt.timeout(() => stack.push("B"), { minutes: 10 });

	expect(stack).toEqual([]);

	await dt.add({ minutes: 5 });
	expect(stack).toEqual([]);

	n2.clear();

	await dt.add({ minutes: 5 });
	expect(stack).toEqual(["A"]);
});
