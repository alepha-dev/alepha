import { Alepha } from "@alepha/core";
import { test } from "vitest";
import { HttpClient } from "../src";

class TestHttpClient extends HttpClient {
	public queryParams(...args: Parameters<HttpClient["queryParams"]>) {
		return super.queryParams(...args);
	}
}

const client = Alepha.create().get(TestHttpClient);

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
