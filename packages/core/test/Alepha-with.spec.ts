import { expect, test } from "vitest";
import { Alepha } from "../src";

test("Alepha#with - from default import", async () => {
	const alepha = Alepha.create();

	alepha.with(await import("./fixtures/A.js"));

	expect(alepha.graph()).toEqual({
		A: {
			from: ["Alepha"],
		},
	});
});
