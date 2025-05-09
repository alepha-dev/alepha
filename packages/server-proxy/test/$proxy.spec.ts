import { Alepha, t } from "@alepha/core";
import { $action, ServerProvider } from "@alepha/server";
import { expect, test } from "vitest";
import { $proxy } from "../src";

const randomPort = Math.floor(Math.random() * 10000) + 1000;

class App {
	hello = $action({
		schema: {
			headers: t.object({
				prefix: t.optional(t.string()),
			}),
			query: t.object({
				transform: t.optional(t.enum(["uppercase"])),
			}),
			body: t.object({
				name: t.string(),
			}),
			response: t.object({
				message: t.string(),
			}),
		},
		handler: ({ body, query, headers, reply }) => {
			let name = body.name;
			if (query.transform === "uppercase") {
				name = name.toUpperCase();
			}
			if (headers.prefix) {
				name = `${headers.prefix}${name}`;
			}
			reply.headers["x-hello"] = "world";
			return {
				message: `Hello ${name}!`,
			};
		},
	});
}

class AppProxy {
	proxy = $proxy({
		path: "/api/*",
		target: `http://localhost:${randomPort}`,
	});
}

Alepha.create({
	env: {
		SERVER_PORT: randomPort,
	},
}).with(App);

const alephaProxy = Alepha.create().with(AppProxy);

test("$proxy", async () => {
	const hostname = alephaProxy.get(ServerProvider).hostname;

	const response = await fetch(`${hostname}/api/hello?transform=uppercase`, {
		method: "POST",
		body: JSON.stringify({ name: "Jack" }),
		headers: {
			"Content-Type": "application/json",
			prefix: "Mr.",
		},
	});

	expect(response.status).toBe(200);

	const json = await response.json();

	expect(response.headers.get("x-hello")).toBe("world");
	expect(json).toEqual({
		message: "Hello Mr.JACK!",
	});
});
