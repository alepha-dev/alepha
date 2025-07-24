import { Alepha } from "@alepha/core";
import { describe, test } from "vitest";
import { HttpClient } from "../src";

describe("HttpClient", () => {
	test("should handle undefined query params", async ({ expect }) => {
		const alepha = Alepha.create();
		const client = alepha.inject(HttpClient);
		await alepha.start();

		expect(
			client.queryParams(
				"",
				{},
				{
					query: {
						hello: undefined as any,
						a: "b",
					},
				},
			),
		).toEqual("?a=b");
	});
});
