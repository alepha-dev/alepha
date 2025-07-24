import { Alepha } from "@alepha/core";
import { describe, test } from "vitest";
import {
	$route,
	BadRequestError,
	HttpClient,
	HttpError,
	ServerProvider,
} from "../src";

describe("HttpClient", () => {
	test("should fetch a URL", async ({ expect }) => {
		const alepha = Alepha.create();
		class TestApp {
			root = $route({
				path: "/",
				handler: () => "Hello, World!",
			});
		}
		const client = alepha.with(TestApp).inject(HttpClient);
		await alepha.start();

		const resp = await client.fetch<string>(
			`${alepha.inject(ServerProvider).hostname}`,
		);

		// response looks like Axios response
		expect(resp.data).toBe("Hello, World!");
	});

	test("should throw on Error", async ({ expect }) => {
		const alepha = Alepha.create();
		class TestApp {
			root = $route({
				path: "/",
				handler: () => {
					throw new BadRequestError();
				},
			});
		}
		const client = alepha.with(TestApp).inject(HttpClient);
		await alepha.start();

		const resp = await client
			.fetch<string>(`${alepha.inject(ServerProvider).hostname}`)
			.catch((e) => e);

		expect(resp).toBeInstanceOf(HttpError);
		expect(HttpError.toJSON(resp)).toEqual({
			error: "BadRequestError",
			message: "Invalid request body",
			status: 400,
		});
	});

	test("should handle empty query params", async ({ expect }) => {
		const alepha = Alepha.create();
		const client = alepha.inject(HttpClient);
		await alepha.start();

		expect(client.queryParams("", {}, {})).toEqual("");
	});

	test("should handle simple query params", async ({ expect }) => {
		const alepha = Alepha.create();
		const client = alepha.inject(HttpClient);
		await alepha.start();

		expect(
			client.queryParams(
				"",
				{},
				{
					query: {
						hello: "world",
						a: "b",
					},
				},
			),
		).toEqual("?hello=world&a=b");
	});

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
