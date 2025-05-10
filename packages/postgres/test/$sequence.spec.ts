import { Alepha } from "@alepha/core";
import { expect, test } from "vitest";
import { $sequence } from "../src";
import { SequenceProvider } from "../src/providers/SequenceProvider.ts";

const alepha = Alepha.create();
const app = alepha.get(
	class App {
		seq = $sequence();
		seq2 = $sequence({ start: 100, increment: 2 });
	},
);

test("$sequence", async () => {
	expect(await app.seq()).toBe(1);
	expect(await app.seq()).toBe(2);
	expect(await app.seq()).toBe(3);
	expect(await app.seq.current()).toBe(3);
	expect(await app.seq.next()).toBe(4);
});

test("$sequence options", async () => {
	expect(await app.seq2()).toBe(100);
	expect(await app.seq2()).toBe(102);
	expect(await app.seq2()).toBe(104);
	expect(await app.seq2.current()).toBe(104);
	expect(await app.seq2.next()).toBe(106);
});

test("$sequence - SeqProvider", async () => {
	const seqProvider = alepha.get(SequenceProvider);
	const seq = await seqProvider.create("test", { start: 100, increment: 2 });
	expect(await seqProvider.next(seq)).toBe(100);
	expect(await seqProvider.next(seq)).toBe(102);
});
