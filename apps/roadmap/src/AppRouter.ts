import { $inject, Alepha, t } from "@alepha/core";
import { $page, NotFound, Redirection } from "@alepha/react";
import { $head } from "@alepha/react-head";
import { HttpError } from "@alepha/server";
import { $client } from "@alepha/server-links";
import { createElement } from "react";
import type ProjectApi from "./api/ProjectApi.ts";
import type TaskApi from "./api/TaskApi.ts";
import { Theme } from "./services/Theme.ts";

export class AppRouter {
	theme = $inject(Theme);
	alepha = $inject(Alepha);
	taskApi = $client<TaskApi>();
	projectApi = $client<ProjectApi>();

	head = $head(() => {
		return {
			title: "Roadmap",
			bodyAttributes: {
				class: this.theme.getColorSchemeClass(),
			},
		};
	});

	login = $page({
		path: "/login",
		lazy: () => import("./components/auth/Login.tsx"),
		resolve: async ({ user }) => {
			if (user) {
				throw new Redirection("/");
			}
		},
	});

	layout = $page({
		children: () => [
			this.home, //
			this.project,
			this.notFound,
		],
		lazy: () => import("./components/Layout.tsx"),
		errorHandler: (error) => {
			if (HttpError.is(error, 401)) {
				return new Redirection("/login"); // redirect to home if unauthorized (and soon /login)
			}
		},
		resolve: async () => {
			this.alepha.state("project", null);
			this.alepha.state("tasks", []);
		},
	});

	home = $page({
		path: "/",
		lazy: () => import("./components/home/Home.tsx"),
	});

	project = $page({
		children: () => [
			this.task, //
		],
		path: "/p/:projectId",
		schema: {
			params: t.object({
				projectId: t.int(),
			}),
		},
		lazy: () => import("./components/project/ProjectView.tsx"),
		resolve: async ({ params }) => {
			const project = await this.projectApi.getProjectById({
				params: {
					id: params.projectId,
				},
			});
			const tasks = await this.taskApi.getTasks({
				params: {
					projectId: params.projectId,
				},
			});

			this.alepha.state("project", project);
			this.alepha.state("tasks", tasks);
		},
	});

	task = $page({
		path: "/q/:taskId",
		schema: {
			params: t.object({
				taskId: t.int(),
			}),
		},
		lazy: () => import("./components/task/TaskView.tsx"),
		resolve: async ({ params }) => {
			const task = await this.taskApi.getTaskById({
				params: {
					id: params.taskId,
				},
			});
			return { task };
		},
		errorHandler: (error) => {
			if (HttpError.is(error, 404)) {
				return createElement(NotFound, { style: { height: "100%" } });
			}
		},
	});

	notFound = $page({
		path: "/*",
		component: NotFound,
	});
}
