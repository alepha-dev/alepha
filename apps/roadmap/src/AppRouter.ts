import { $inject } from "@alepha/core";
import { $page } from "@alepha/react";
import { $head } from "@alepha/react-head";
import { $client } from "@alepha/server-links";
import type TaskApi from "./api/TaskApi.ts";
import { Theme } from "./services/Theme.ts";

export class AppRouter {
	theme = $inject(Theme);
	client = $client<TaskApi>();

	head = $head(() => {
		return {
			title: "Roadmap",
			bodyAttributes: {
				class: this.theme.getColorSchemeClass(),
			},
		};
	});

	home = $page({
		path: "/",
		lazy: () => import("./components/Home.tsx"),
		resolve: async () => {
			if (!this.client.getTasks.can()) {
				return { tasks: [] };
			}
			return {
				tasks: await this.client.getTasks(),
			};
		},
	});
}
