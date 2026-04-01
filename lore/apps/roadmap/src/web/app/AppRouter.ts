import { AuthRouter } from "@alepha/ui/auth";
import { $hook, $inject, Alepha, t } from "alepha";
import { ReactAuth } from "alepha/react/auth";
import { $head, type Head } from "alepha/react/head";
import { $page, NotFound, ReactRouter, Redirection } from "alepha/react/router";
import { currentUserAtom } from "alepha/security";
import { HttpError, NotFoundError } from "alepha/server";
import { $client } from "alepha/server/links";
import { createElement } from "react";
import type { ChapterController } from "../../api/controllers/ChapterController.ts";
import type { InvitationController } from "../../api/controllers/InvitationController.ts";
import type { KanbanController } from "../../api/controllers/KanbanController.ts";
import type { ProjectController } from "../../api/controllers/ProjectController.ts";
import type { ProjectStatsController } from "../../api/controllers/ProjectStatsController.ts";
import type { TaskController } from "../../api/controllers/TaskController.ts";
import type { WhiteboardController } from "../../api/controllers/WhiteboardController.ts";
import { currentAssignedTasksAtom } from "./atoms/currentAssignedTasksAtom.ts";
import { currentChaptersAtom } from "./atoms/currentChaptersAtom.ts";
import { currentProjectAtom } from "./atoms/currentProjectAtom.ts";
import { currentProjectCharacterAtom } from "./atoms/currentProjectCharacterAtom.ts";
import { currentTaskAtom } from "./atoms/currentTaskAtom.ts";
import {
  currentWhiteboardAtom,
  currentWhiteboardsAtom,
} from "./atoms/currentWhiteboardsAtom.ts";
import { userProjectsAtom } from "./atoms/userProjectsAtom.ts";
import { AppAdminRouter } from "../admin/AppAdminRouter.ts";
import { MeRouter } from "./components/profile/me/MeRouter.ts";
import ErrorPage from "./components/shared/ErrorPage.tsx";

export class AppRouter {
  alepha = $inject(Alepha);
  taskApi = $client<TaskController>();
  projectApi = $client<ProjectController>();
  projectStatsApi = $client<ProjectStatsController>();
  whiteboardApi = $client<WhiteboardController>();
  invitationApi = $client<InvitationController>();
  kanbanApi = $client<KanbanController>();
  chapterApi = $client<ChapterController>();
  router = $inject(ReactRouter);
  auth = $inject(ReactAuth);
  meRouter = $inject(MeRouter);
  adminRouter = $inject(AppAdminRouter);
  authRouter = $inject(AuthRouter);

  head = $head(() => {
    const head: Head = {
      title: "Roadmap",
      titleSeparator: " - ",
      description: "Roadmap - Gamified project management",
    };

    head.link = [
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      { rel: "manifest", href: "/manifest.json" },
    ];

    head.meta = [
      { name: "theme-color", content: "#010409" },
      {
        name: "keywords",
        content: "Alepha, Roadmap, open-source, applications, platform",
      },
    ];

    return head;
  });

  layout = $page({
    children: () => [
      this.home, //
      this.project,
      this.projectCreate,
      this.kanban,
      this.meRouter.me,
      this.adminRouter.admin.adminLayout,
      this.notFound,
    ],
    lazy: () => import("./components/Layout.tsx"),
    loader: async ({ user }) => {
      if (user) {
        this.alepha.store.set(
          userProjectsAtom,
          await this.projectApi.getMyProjects(),
        );
      }
    },
    errorHandler: (error, state) => {
      if (HttpError.is(error, 401) && state.url.pathname !== "/auth/login") {
        return new Redirection(`/auth/login?r=${state.url.pathname}`);
      }

      if (!this.alepha.isProduction()) {
        return;
      }

      return createElement(ErrorPage);
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
        this.alepha.store.set(currentUserAtom, undefined);
        await this.router.push(loginPath, {
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
    head: {
      title: "Home",
    },
  });

  projectCreate = $page({
    path: "/p-new",
    lazy: () => import("./components/project/ProjectCreate.tsx"),
  });

  kanban = $page({
    path: "/k/:projectId",
    schema: {
      params: t.object({
        projectId: t.integer(),
      }),
    },
    head: {
      title: "Kanban",
    },
    lazy: () => import("./components/kanban/KanbanBoard.tsx"),
    loader: async ({ params }) => {
      const data = await this.kanbanApi.getBoard({
        params: { projectId: params.projectId },
      });
      return data;
    },
  });

  project = $page({
    children: () => [
      this.projectBoard,
      this.projectChapters,
      this.projectSettings,
      this.projectAnalytics,
      this.projectWhiteboards,
    ],
    path: "/p/:projectId",
    schema: {
      params: t.object({
        projectId: t.integer(),
      }),
    },
    lazy: () => import("./components/project/ProjectView.tsx"),
    loader: async ({ params }) => {
      const { character, tasks, ...project } =
        await this.projectApi.getProjectById({
          params: {
            id: params.projectId,
          },
        });

      const chapters = await this.chapterApi.getChapters({
        params: { projectId: params.projectId },
      });

      this.alepha.store.set(currentProjectAtom, project);
      this.alepha.store.set(currentProjectCharacterAtom, character);
      this.alepha.store.set(currentAssignedTasksAtom, tasks);
      this.alepha.store.set(currentChaptersAtom, chapters);

      return {
        project,
      };
    },
    onLeave: () => {
      this.alepha.store.set(currentProjectCharacterAtom, undefined);
      this.alepha.store.set(currentProjectAtom, undefined);
      this.alepha.store.set(currentAssignedTasksAtom, []);
      this.alepha.store.set(currentChaptersAtom, undefined);
    },
  });

  projectBoard = $page({
    children: () => [this.projectBoardTable, this.projectTask],
    path: "/",
    lazy: () => import("./components/project/ProjectBoard.tsx"),
  });

  projectBoardTable = $page({
    path: "/",
    lazy: () => import("./components/project/ProjectBoardTable.tsx"),
  });

  projectChapters = $page({
    path: "/chapters",
    lazy: () => import("./components/project/chapters/ProjectChapters.tsx"),
  });

  projectAnalytics = $page({
    path: "/analytics",
    lazy: () => import("./components/project/ProjectStats.tsx"),
    loader: async ({ params }) => {
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
    lazy: () => import("./components/project/settings/ProjectSettings.tsx"),
    loader: async () => {
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
          .catch(() => []),
      ]);

      return {
        project,
        players,
        pendingInvitations: pendingInvitations.filter(
          (inv) => inv.status === "pending",
        ),
      };
    },
  });

  projectWhiteboards = $page({
    path: "/whiteboards",
    lazy: () => import("./components/project/ProjectWhiteboards.tsx"),
    loader: async () => {
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
    loader: async ({ params }) => {
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
