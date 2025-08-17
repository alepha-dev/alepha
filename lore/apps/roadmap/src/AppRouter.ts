import { $hook, $inject, Alepha, t } from "@alepha/core";
import { $page, NotFound, ReactRouter, Redirection } from "@alepha/react";
import { ReactAuth } from "@alepha/react-auth";
import { $head } from "@alepha/react-head";
import { HttpError } from "@alepha/server";
import { $client } from "@alepha/server-links";
import { createElement } from "react";
import type { ProjectApi } from "./api/ProjectApi.ts";
import type { TaskApi } from "./api/TaskApi.ts";
import type { UserApi } from "./api/UserApi.ts";
import ErrorPage from "./components/shared/ErrorPage.tsx";
import { Theme } from "./services/Theme.ts";

export class AppRouter {
	theme = $inject(Theme);
	alepha = $inject(Alepha);

	taskApi = $client<TaskApi>();
	projectApi = $client<ProjectApi>();
	userApi = $client<UserApi>();

	router = $inject(ReactRouter);
	auth = $inject(ReactAuth);

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
		schema: {
			query: t.object({
				r: t.optional(t.string()),
			}),
		},
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
			this.projectCreate,
			this.profile,
			this.notFound,
		],
		lazy: () => import("./components/Layout.tsx"),
		resolve: async ({ user }) => {
			if (user) {
				this.alepha.state(
					"user.projects",
					await this.projectApi.getMyProjects(),
				);
			}
		},
		errorHandler: (error, ctx) => {
			if (HttpError.is(error, 401)) {
				return new Redirection(`/login?r=${ctx.url.pathname}`);
			}

			if (this.alepha.isProduction()) {
				return createElement(ErrorPage, {
					error,
					alepha: this.alepha,
				});
			}
		},
	});

	onFetchError = $hook({
		on: "client:onError",
		handler: async ({ error }) => {
			if (
				HttpError.is(error, 401) &&
				this.alepha.isBrowser() &&
				this.auth.user &&
				this.router.state.url.pathname !== "/login"
			) {
				await this.router.go(`/login?r=${this.router.state.url.pathname}`);
			}
		},
	});

	home = $page({
		path: "/",
		lazy: () => import("./components/home/Home.tsx"),
	});

	profile = $page({
		path: "/me",
		lazy: () => import("./components/auth/Profile.tsx"),
		resolve: async () => {
			return {
				user: await this.userApi.me(),
			};
		},
	});

	projectCreate = $page({
		path: "/p-new",
		lazy: () => import("./components/project/ProjectCreate.tsx"),
	});

	project = $page({
		children: () => [
			this.projectTask, //
			this.projectBoard,
			this.projectSettings,
			this.projectAnalytics,
			this.projectPlayers,
		],
		path: "/p/:projectId",
		schema: {
			params: t.object({
				projectId: t.int(),
			}),
		},
		lazy: () => import("./components/project/ProjectView.tsx"),
		resolve: async ({ params }) => {
			const { character, tasks, ...project } =
				await this.projectApi.getProjectById({
					params: {
						id: params.projectId,
					},
				});

			this.alepha.state("project", project);
			this.alepha.state("character", character);
			this.alepha.state("tasks", tasks);

			return {
				project,
			};
		},
		onLeave: () => {
			this.alepha.state("character", null);
			this.alepha.state("project", null);
			this.alepha.state("tasks", []);
		},
	});

	projectBoard = $page({
		path: "/",
		lazy: () => import("./components/project/ProjectBoard.tsx"),
	});

	projectPlayers = $page({
		path: "/players",
		lazy: () => import("./components/project/ProjectPlayers.tsx"),
	});

	projectAnalytics = $page({
		path: "/analytics",
		lazy: () => import("./components/project/ProjectStats.tsx"),
	});

	projectSettings = $page({
		path: "/settings",
		lazy: () => import("./components/project/ProjectSettings.tsx"),
	});

	projectTask = $page({
		path: "/q/:taskId",
		schema: {
			params: t.object({
				taskId: t.int(),
			}),
		},
		lazy: () => import("./components/project/task/TaskView.tsx"),
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
