import { Alepha, t } from "@alepha/core";
import { $action, ServerProvider } from "@alepha/server";
import { describe, test } from "vitest";
import { $swagger } from "../src";

class App {
	docs = $swagger({
		info: {
			title: "Test API",
			description: "This is a test API",
			version: "1.0.0",
		},
		prefix: "/test",
		ui: true,
	});

	hello = $action({
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
}

describe("Swagger UI", () => {
	const alepha = Alepha.create().with(App);
	const server = alepha.get(ServerProvider);

	test("ui", async ({ expect }) => {
		const html = await fetch(`${server.hostname}/test/`).then((it) =>
			it.text(),
		);
		expect(html).toContain('<div id="swagger-ui"></div>');

		const initializer = await fetch(
			`${server.hostname}/test/swagger-initializer.js`,
		).then((it) => it.text());
		expect(initializer).toContain("SwaggerUIBundle");

		const json = await fetch(`${server.hostname}/test/json`).then((it) =>
			it.text(),
		);
		expect(json).toContain("Test API");
		expect(json).toContain("hello");
	});
});
