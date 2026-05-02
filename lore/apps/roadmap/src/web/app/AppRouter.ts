import { $hook, $inject, Alepha, t } from "alepha";
import type { RealmController } from "alepha/api/users";
import { ReactAuth } from "alepha/react/auth";
import { $head, type Head } from "alepha/react/head";
import { $page, NotFound, ReactRouter, Redirection } from "alepha/react/router";
import { currentUserAtom } from "alepha/security";
import { HttpError, NotFoundError } from "alepha/server";
import { $client } from "alepha/server/links";
import { createElement } from "react";
import type { AdminInvitationController } from "../../api/controllers/AdminInvitationController.ts";
import type { ChapterController } from "../../api/controllers/ChapterController.ts";
import type { KanbanController } from "../../api/controllers/KanbanController.ts";
import type { ProjectController } from "../../api/controllers/ProjectController.ts";
import type { ProjectStatsController } from "../../api/controllers/ProjectStatsController.ts";
import type { TaskController } from "../../api/controllers/TaskController.ts";
import { currentAssignedTasksAtom } from "./atoms/currentAssignedTasksAtom.ts";
import { currentChaptersAtom } from "./atoms/currentChaptersAtom.ts";
import { currentProjectAtom } from "./atoms/currentProjectAtom.ts";
import { currentProjectCharacterAtom } from "./atoms/currentProjectCharacterAtom.ts";
import { currentTaskAtom } from "./atoms/currentTaskAtom.ts";
import { userProjectsAtom } from "./atoms/userProjectsAtom.ts";
import { MeRouter } from "./components/profile/me/MeRouter.ts";
import ErrorPage from "./components/shared/ErrorPage.tsx";

export class AppRouter {
  alepha = $inject(Alepha);
  taskApi = $client<TaskController>();
  projectApi = $client<ProjectController>();
  projectStatsApi = $client<ProjectStatsController>();
  invitationAdminApi = $client<AdminInvitationController>();
  kanbanApi = $client<KanbanController>();
  chapterApi = $client<ChapterController>();
  router = $inject(ReactRouter);
  auth = $inject(ReactAuth);
  meRouter = $inject(MeRouter);
  realmApi = $client<RealmController>();

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
      this.home,
      this.login,
      this.register,
      this.project,
      this.projectCreate,
      this.kanban,
      this.meRouter.me,
      this.notFound,
    ],
    ssr: false,
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

  login = $page({
    path: "/auth/login",
    name: "login",
    head: { title: "Sign in" },
    lazy: () => import("./components/auth/AuthLoginPage.tsx"),
    loader: async () => {
      const realmConfig = await this.realmApi.getRealmConfig();
      return { realmConfig };
    },
  });

  register = $page({
    path: "/auth/register",
    name: "register",
    head: { title: "Sign up" },
    lazy: () => import("./components/auth/AuthRegisterPage.tsx"),
    loader: async () => {
      const realmConfig = await this.realmApi.getRealmConfig();
      return { realmConfig };
    },
  });

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
    loader: async () => {
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
        this.invitationAdminApi
          .findInvitations({
            query: {
              resourceType: "project",
              resourceId: String(project.id),
              status: "pending",
            },
          })
          .then((page) => page.content)
          .catch(() => []),
      ]);

      return {
        project,
        players,
        pendingInvitations,
      };
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
