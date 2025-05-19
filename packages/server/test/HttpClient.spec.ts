import { Alepha } from "@alepha/core";
import { test } from "vitest";
import { HttpClient } from "../src";

const client = Alepha.create().get(HttpClient);

test("HttpClient - queryParams undefined", async ({ expect }) => {
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
