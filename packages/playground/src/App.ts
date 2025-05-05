import { $inject } from "@alepha/core";
import { $page } from "@alepha/react";
import { HttpClient } from "@alepha/server";
import type Api from "./Api.ts";

export class App {
	api = $inject(HttpClient).of<Api>();
	client = $inject(HttpClient);

	home = $page({
		lazy: () => import("./components/Home.tsx"),
	});

	test = $page({
		name: "Test",
		path: "/test",
		can: () => this.api.inc.can(),
		head: (q) => {
			return {
				title: `Test ${q.inc.v}`,
			};
		},
		resolve: async () => {
			return {
				inc: await this.api.inc(),
			};
		},
		lazy: () => import("./components/Test.tsx"),
	});

	layout = $page({
		resolve: async ({ query }) => {
			return {
				name: query.name ?? "Alepha",
			};
		},
		head: (q) => {
			return {
				title: `Hello ${q.name}`,
				titleSeparator: " - ",
				htmlAttributes: {
					lang: "en",
					"data-mantine-color-scheme": "dark",
				},
				meta: [
					{
						name: "description",
						content: "Alepha Playground",
					},
				],
			};
		},
		lazy: () => import("./components/Layout.tsx"),
		children: [this.home, this.test],
	});
}
