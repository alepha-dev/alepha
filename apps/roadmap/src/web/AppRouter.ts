import { ReactAuth } from "@alepha/react/auth";
import { $head } from "@alepha/react/head";
import {
  $page,
  NotFound,
  ReactRouter,
  Redirection,
} from "@alepha/react/router";
import { AuthRouter } from "@alepha/ui/auth";
import { $hook, $inject, Alepha, t } from "alepha";
import { HttpError, NotFoundError } from "alepha/server";
import { $client } from "alepha/server/links";
import { createElement } from "react";
import type { InvitationController } from "../api/controllers/InvitationController.ts";
import type { ProjectController } from "../api/controllers/ProjectController.ts";
import type { ProjectStatsController } from "../api/controllers/ProjectStatsController.ts";
import type { TaskController } from "../api/controllers/TaskController.ts";
import type { WhiteboardController } from "../api/controllers/WhiteboardController.ts";
import { currentAssignedTasksAtom } from "./atoms/currentAssignedTasksAtom.ts";
import { currentProjectAtom } from "./atoms/currentProjectAtom.ts";
import { currentProjectCharacterAtom } from "./atoms/currentProjectCharacterAtom.ts";
import { currentTaskAtom } from "./atoms/currentTaskAtom.ts";
import {
  currentWhiteboardAtom,
  currentWhiteboardsAtom,
} from "./atoms/currentWhiteboardsAtom.ts";
import { userProjectsAtom } from "./atoms/userProjectsAtom.ts";
import { AdminRouter } from "./components/admin/AdminRouter.ts";
import { MeRouter } from "./components/profile/MeRouter.ts";
import ErrorPage from "./components/shared/ErrorPage.tsx";

export class AppRouter {
  alepha = $inject(Alepha);
  taskApi = $client<TaskController>();
  projectApi = $client<ProjectController>();
  projectStatsApi = $client<ProjectStatsController>();
  whiteboardApi = $client<WhiteboardController>();
  invitationApi = $client<InvitationController>();
  router = $inject(ReactRouter);
  auth = $inject(ReactAuth);
  meRouter = $inject(MeRouter);
  adminRouter = $inject(AdminRouter);
  authRouter = $inject(AuthRouter);

  head = $head(() => ({
    title: "Roadmap",
    description: "Roadmap - Gamified project management",
  }));

  layout = $page({
    children: () => [
      this.authRouter.layout,
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
        this.alepha.store.set(
          userProjectsAtom,
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
      const loginPath = this.router.path("login");
      if (
        this.alepha.isBrowser() &&
        HttpError.is(error, 401) &&
        this.router.state.url.pathname !== loginPath
      ) {
        this.alepha.store.set("alepha.server.request.user", undefined);
        await this.router.go(loginPath, {
          query: {
            redirect: this.router.state.url.pathname,
          },
        });
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
      this.projectWhiteboards,
    ],
    path: "/p/:projectId",
    schema: {
      params: t.object({
        projectId: t.integer(),
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

      this.alepha.store.set(currentProjectAtom, project);
      this.alepha.store.set(currentProjectCharacterAtom, character);
      this.alepha.store.set(currentAssignedTasksAtom, tasks);

      return {
        project,
      };
    },
    onLeave: () => {
      this.alepha.store.set(currentProjectCharacterAtom, undefined);
      this.alepha.store.set(currentProjectAtom, undefined);
      this.alepha.store.set(currentAssignedTasksAtom, []);
    },
  });

  projectBoard = $page({
    path: "/",
    lazy: () => import("./components/project/ProjectBoard.tsx"),
  });

  projectPlayers = $page({
    path: "/players",
    lazy: () => import("./components/project/ProjectPlayers.tsx"),
    resolve: async ({ params }) => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }

      const [players, pendingInvitations] = await Promise.all([
        this.projectApi.getProjectPlayers({
          params: { id: project.id },
        }),
        this.invitationApi
          .getProjectInvitations({
            params: { projectId: project.id },
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
          id: this.alepha.store.get(currentProjectAtom)?.id ?? -1,
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
    resolve: async () => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }

      return {
        project,
      };
    },
  });

  projectWhiteboards = $page({
    path: "/whiteboards",
    lazy: () => import("./components/project/ProjectWhiteboards.tsx"),
    resolve: async () => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }

      const whiteboards = await this.whiteboardApi.getWhiteboards({
        params: { projectId: project.id },
      });

      this.alepha.store.set(currentWhiteboardsAtom, whiteboards);
      if (whiteboards.length > 0) {
        this.alepha.store.set(currentWhiteboardAtom, whiteboards[0]);
      }

      return {
        project,
        whiteboards,
      };
    },
    onLeave: () => {
      this.alepha.store.set(currentWhiteboardsAtom, []);
      this.alepha.store.set(currentWhiteboardAtom, undefined);
    },
  });

  projectTask = $page({
    path: "/q/:taskId",
    schema: {
      params: t.object({
        taskId: t.integer(),
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
    },
    lazy: () => import("./components/project/task/TaskView.tsx"),
    resolve: async ({ params }) => {
      const task = await this.taskApi.getTaskById({
        params: {
          id: params.taskId,
        },
      });
      this.alepha.store.set(currentTaskAtom, task);
      return { task };
    },
    onLeave: () => {
      this.alepha.store.set(currentTaskAtom, undefined);
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
