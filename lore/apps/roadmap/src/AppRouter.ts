import { $inject, t } from "@alepha/core";
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

	layout = $page({
		children: () => [
			this.home, //
			this.taskById,
		],
		lazy: () => import("./components/Layout.tsx"),
		resolve: async () => {
			if (!this.client.getTasks.can()) {
				return { tasks: [] };
			}
			return {
				tasks: await this.client.getTasks(),
			};
		},
		errorHandler: (error) => {
			if ("status" in error && error.status === 404) {
				return "NotFound";
			}
			throw error; // rethrow other errors
		},
	});

	home = $page({
		path: "/",
		lazy: () => import("./components/home/Home.tsx"),
	});

	taskById = $page({
		path: "/q/:id",
		schema: {
			params: t.object({
				id: t.int(),
			}),
		},
		lazy: () => import("./components/task/TaskView.tsx"),
		resolve: async ({ params }) => {
			const task = await this.client.getTaskById({
				params,
			});
			return { task };
		},
	});
}
