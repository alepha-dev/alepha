import { Alepha } from "@alepha/core";
import { expect, test } from "vitest";
import { $sequence } from "../src";

const alepha = Alepha.create();
const app = alepha.inject(
	class App {
		seq = $sequence();
		seq2 = $sequence({ start: 100, increment: 2 });
	},
);

test("$sequence", async () => {
	expect(await app.seq.next()).toBe(1);
	expect(await app.seq.next()).toBe(2);
	expect(await app.seq.next()).toBe(3);
	expect(await app.seq.current()).toBe(3);
	expect(await app.seq.next()).toBe(4);
});

test("$sequence options", async () => {
	expect(await app.seq2.next()).toBe(100);
	expect(await app.seq2.next()).toBe(102);
	expect(await app.seq2.next()).toBe(104);
	expect(await app.seq2.current()).toBe(104);
	expect(await app.seq2.next()).toBe(106);
});
