import { Alepha, t } from "@alepha/core";
import { $action, ServerProvider } from "@alepha/server";
import { test } from "vitest";
import { LinkProvider, ServerLinksProvider } from "../src";

class App {
	ping = $action({
		schema: {
			response: t.object({
				pong: t.boolean(),
			}),
		},
		handler: () => {
			return { pong: true };
		},
	});
}

test("LinkProvider - local handler", async ({ expect }) => {
	const alepha = Alepha.create().with(App).with(ServerLinksProvider);
	await alepha.start();

	const app = alepha.get(LinkProvider).client<App>();

	expect(await app.ping()).toStrictEqual({ pong: true });
});

test("LinkProvider - links", async ({ expect }) => {
	const alepha = Alepha.create().with(App).with(ServerLinksProvider);
	await alepha.start();

	const res = await fetch(`${alepha.get(ServerProvider).hostname}/api/_links`);

	expect(await res.json()).toStrictEqual({
		prefix: "/api",
		links: [
			{
				group: "app",
				name: "ping",
				path: "/ping",
			},
		],
	});
});
