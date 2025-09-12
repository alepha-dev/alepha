import { $hook, $inject, Alepha, t } from "@alepha/core";
import { $page, NotFound, ReactRouter, Redirection } from "@alepha/react";
import { ReactAuth } from "@alepha/react-auth";
import { $head } from "@alepha/react-head";
import { HttpError } from "@alepha/server";
import { $client } from "@alepha/server-links";
import { notifications } from "@mantine/notifications";
import { createElement } from "react";
import type { InvitationApi } from "./api/InvitationApi.ts";
import type { ProjectApi } from "./api/ProjectApi.ts";
import type { ProjectStatsApi } from "./api/ProjectStatsApi.ts";
import type { TaskApi } from "./api/TaskApi.ts";
import { AdminRouter } from "./components/admin/AdminRouter.ts";
import { MeRouter } from "./components/auth/MeRouter.ts";
import ErrorPage from "./components/shared/ErrorPage.tsx";

export class AppRouter {
	alepha = $inject(Alepha);
	taskApi = $client<TaskApi>();
	projectApi = $client<ProjectApi>();
	projectStatsApi = $client<ProjectStatsApi>();
	invitationApi = $client<InvitationApi>();
	router = $inject(ReactRouter);
	auth = $inject(ReactAuth);
	meRouter = $inject(MeRouter);
	adminRouter = $inject(AdminRouter);

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
			this.adminRouter.admin,
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

	onFormError = $hook({
		on: "form:submit:error",
		handler: async ({ error }) => {
			notifications.show({
				title: "Invalid Request",
				message: error.message || "An error occurred",
				color: "red",
				position: "top-center",
				autoClose: 5000,
			});
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
			this.projectShop,
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

			this.alepha.state("current_project", project);
			this.alepha.state("current_project_character", character);
			this.alepha.state("current_assigned_tasks", tasks);

			return {
				project,
			};
		},
		onLeave: () => {
			this.alepha.state("current_project_character", null);
			this.alepha.state("current_project", null);
			this.alepha.state("current_assigned_tasks", []);
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
		resolve: async ({ params }) => {
			const project = this.alepha.state("current_project");
			const projectId = project?.id ?? -1;

			const [players, pendingInvitations] = await Promise.all([
				this.projectApi.getProjectPlayers({
					params: { id: projectId },
				}),
				this.invitationApi
					.getProjectInvitations({
						params: { projectId },
					})
					.catch(() => []), // Fail gracefully if no permission
			]);

			return {
				players,
				project,
				pendingInvitations: pendingInvitations.filter(
					(inv) => inv.status === "pending",
				),
			};
		},
	});

	projectAnalytics = $page({
		path: "/analytics",
		lazy: () => import("./components/project/ProjectStats.tsx"),
		resolve: async ({ params }) => {
			const stats = await this.projectStatsApi.getProjectStats({
				params: {
					id: this.alepha.state("current_project")?.id ?? -1,
				},
			});
			return {
				stats,
			};
		},
	});

	projectSettings = $page({
		path: "/settings",
		lazy: () => import("./components/project/ProjectSettings.tsx"),
		animation: "fadeInUpLight",
	});

	projectShop = $page({
		path: "/shop",
		lazy: () => import("./components/project/ProjectShop.tsx"),
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
			if (meta.transition) {
				return meta.transition;
			}

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
			this.alepha.state("current_task", task);
			return { task };
		},
		onLeave: () => {
			this.alepha.state("current_task", null);
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
