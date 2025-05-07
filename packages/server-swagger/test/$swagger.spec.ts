import { Alepha, t } from "@alepha/core";
import { $action } from "@alepha/server";
import { expect, test } from "vitest";
import { $swagger } from "../src";

class App {
	internal = $action({
		internal: true,
		schema: {
			response: t.object({
				message: t.string(),
			}),
		},
		handler: async () => {
			return {
				message: "Hello world",
			};
		},
	});

	api = $action({
		internal: true,
		schema: {
			response: t.object({
				message: t.string(),
			}),
		},
	});

	hello = $action({
		path: "/hello/:name",
		name: "hello",
		description: "Hello world",
		group: "app",
		schema: {
			params: t.object({
				name: t.string(),
			}),
			query: t.object({
				age: t.optional(t.number()),
			}),
			body: t.object({
				name: t.string(),
			}),
			response: t.object(
				{
					message: t.string(),
				},
				{
					title: "HelloResponse",
					description: "Hello response",
				},
			),
		},
		handler: async (req) => {
			return {
				message: `Hello ${req.body.name}`,
			};
		},
	});

	docs = $swagger({
		info: {
			title: "My API",
			version: "1.0.0",
		},
	});
}

const alepha = Alepha.create().with(App);

test("$swagger", () => {
	const app = alepha.get(App);
	const swagger = app.docs.json();

	expect(swagger).toEqual({
		openapi: "3.0.0",
		info: {
			title: "My API",
			version: "1.0.0",
		},
		paths: {
			"/api/hello/{name}": {
				post: {
					operationId: "hello",
					parameters: [
						{
							in: "query",
							name: "age",
							required: false,
							schema: {
								type: "number",
							},
						},
						{
							in: "path",
							name: "name",
							required: true,
							schema: {
								maxLength: 255,
								type: "string",
							},
						},
					],
					summary: "hello",
					description: "Hello world",
					tags: ["app"],
					responses: {
						"200": {
							description: "",
							content: {
								"application/json": {
									schema: {
										title: "HelloResponse",
										description: "Hello response",
										additionalProperties: false,
										type: "object",
										properties: {
											message: {
												maxLength: 255,
												type: "string",
											},
										},
										required: ["message"],
									},
								},
							},
						},
					},
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									additionalProperties: false,
									type: "object",
									properties: {
										name: {
											maxLength: 255,
											type: "string",
										},
									},
									required: ["name"],
								},
							},
						},
					},
				},
			},
		},
		components: {},
	});
});
