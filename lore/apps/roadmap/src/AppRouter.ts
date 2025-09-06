import { $hook, $inject, Alepha, t } from "@alepha/core";
import { $page, NotFound, ReactRouter, Redirection } from "@alepha/react";
import { ReactAuth } from "@alepha/react-auth";
import { $head } from "@alepha/react-head";
import { HttpError } from "@alepha/server";
import { $client } from "@alepha/server-links";
import { createElement } from "react";
import type { ProjectApi } from "./api/ProjectApi.ts";
import type { TaskApi } from "./api/TaskApi.ts";
import { MeRouter } from "./components/auth/MeRouter.ts";
import ErrorPage from "./components/shared/ErrorPage.tsx";

export class AppRouter {
	alepha = $inject(Alepha);
	taskApi = $client<TaskApi>();
	projectApi = $client<ProjectApi>();
	router = $inject(ReactRouter);
	auth = $inject(ReactAuth);
	meRouter = $inject(MeRouter);

	head = $head(() => ({
		title: "Roadmap",
	}));

	login = $page({
		path: "/login",
		schema: {
			query: t.object({
				r: t.optional(t.string()),
			}),
		},
		lazy: () => import("./components/auth/Login.tsx"),
	});

	layout = $page({
		children: () => [
			this.login, //
			this.home, //
			this.project,
			this.projectCreate,
			this.meRouter.me,
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
		errorHandler: (error, state) => {
			if (HttpError.is(error, 401) && state.url.pathname !== "/login") {
				return new Redirection(`/login?r=${state.url.pathname}`);
			}

			if (!this.alepha.isProduction()) {
				return;
			}

			return createElement(ErrorPage, {
				error,
				alepha: this.alepha,
			});
		},
	});

	// -------------------------------------------------------------------------------------------------------------------

	onFetchError = $hook({
		on: "client:onError",
		handler: async ({ error }) => {
			// when user try to access a resource without being logged in (expired session or just no logged in)
			if (
				this.alepha.isBrowser() &&
				HttpError.is(error, 401) &&
				this.router.state.url.pathname !== "/login"
			) {
				this.alepha.state("user", undefined);
				await this.router.go(`/login?r=${this.router.state.url.pathname}`);
			}
		},
	});

	// -------------------------------------------------------------------------------------------------------------------

	home = $page({
		path: "/",
		lazy: () => import("./components/home/Home.tsx"),
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
		animation: {
			enter: "fadeInUp",
			exit: "backOutDown",
		},
	});

	projectBoard = $page({
		path: "/",
		lazy: () => import("./components/project/ProjectBoard.tsx"),
		animation: {
			enter: "fadeInUpLight",
			exit: "fadeOutDownLight",
		},
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
		animation: "fadeInUpLight",
	});

	projectTask = $page({
		path: "/q/:taskId",
		schema: {
			params: t.object({
				taskId: t.int(),
			}),
		},
		animation: ({ meta }) => {
			if (meta.completed) {
				return {
					exit: {
						name: "zoomOutUp",
						duration: 800,
					},
				};
			}

			if (meta.deleted) {
				return {
					exit: {
						name: "zoomOut",
						duration: 400,
					},
				};
			}

			return {
				enter: {
					name: "genieIn",
					duration: 500,
					timing: "cubic-bezier(0.22, 1, 0.36, 1)",
				},
				exit: {
					name: "fadeOutDownLight",
				},
			};
		},
		lazy: () => import("./components/project/task/TaskView.tsx"),
		resolve: async ({ params }) => {
			const task = await this.taskApi.getTaskById({
				params: {
					id: params.taskId,
				},
			});
			this.alepha.state("task", task);
			return { task };
		},
		onLeave: () => {
			this.alepha.state("task", null);
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
