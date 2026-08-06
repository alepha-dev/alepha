import { $hook, $inject, Alepha, z } from "alepha";
import type { RealmController } from "alepha/api/users";
import { ReactAuth } from "alepha/react/auth";
import { $head, type Head } from "alepha/react/head";
import { $page, NotFound, ReactRouter, Redirection } from "alepha/react/router";
import { currentUserAtom } from "alepha/security";
import { HttpError, NotFoundError } from "alepha/server";
import { $client } from "alepha/server/links";
import { createElement } from "react";
import type { AdminInvitationController } from "../../api/controllers/AdminInvitationController.ts";
import type { BlightController } from "../../api/controllers/BlightController.ts";
import type { DirectoryController } from "../../api/controllers/DirectoryController.ts";
import type { FeedbackController } from "../../api/controllers/FeedbackController.ts";
import type { FolioController } from "../../api/controllers/FolioController.ts";
import type { InsightsController } from "../../api/controllers/InsightsController.ts";
import type { InvitationController } from "../../api/controllers/InvitationController.ts";
import type { MilestoneController } from "../../api/controllers/MilestoneController.ts";
import type { ProjectController } from "../../api/controllers/ProjectController.ts";
import type { ProjectReportsController } from "../../api/controllers/ProjectReportsController.ts";
import type { QuestController } from "../../api/controllers/QuestController.ts";
import type { SigilController } from "../../api/controllers/SigilController.ts";
import { currentAssignedQuestsAtom } from "./atoms/currentAssignedQuestsAtom.ts";
import { currentBlightCountAtom } from "./atoms/currentBlightCountAtom.ts";
import { currentFeedbackCountAtom } from "./atoms/currentFeedbackCountAtom.ts";
import { currentFolioAtom } from "./atoms/currentFolioAtom.ts";
import { currentFolioContentsAtom } from "./atoms/currentFolioContentsAtom.ts";
import { currentFolioPathAtom } from "./atoms/currentFolioPathAtom.ts";
import { currentMilestonesAtom } from "./atoms/currentMilestonesAtom.ts";
import { currentProjectAtom } from "./atoms/currentProjectAtom.ts";
import { currentProjectMemberAtom } from "./atoms/currentProjectMemberAtom.ts";
import { currentQuestAtom } from "./atoms/currentQuestAtom.ts";
import { currentQuestCountAtom } from "./atoms/currentQuestCountAtom.ts";
import { currentSigilAtom } from "./atoms/currentSigilAtom.ts";
import { currentSigilInsightsAtom } from "./atoms/currentSigilInsightsAtom.ts";
import { currentSigilsAtom } from "./atoms/currentSigilsAtom.ts";
import { folioTagsAtom } from "./atoms/folioTagsAtom.ts";
import { projectDirectoriesAtom } from "./atoms/projectDirectoriesAtom.ts";
import { userFoliosAtom } from "./atoms/userFoliosAtom.ts";
import { userProjectsAtom } from "./atoms/userProjectsAtom.ts";
import { MeRouter } from "./components/profile/me/MeRouter.ts";
import ErrorPage from "./components/shared/ErrorPage.tsx";

export class AppRouter {
  alepha = $inject(Alepha);
  questApi = $client<QuestController>();
  projectApi = $client<ProjectController>();
  projectReportsApi = $client<ProjectReportsController>();
  invitationAdminApi = $client<AdminInvitationController>();
  invitationApi = $client<InvitationController>();
  feedbackApi = $client<FeedbackController>();
  blightApi = $client<BlightController>();
  insightsApi = $client<InsightsController>();
  milestoneApi = $client<MilestoneController>();
  sigilApi = $client<SigilController>();
  folioApi = $client<FolioController>();
  directoryApi = $client<DirectoryController>();
  router = $inject(ReactRouter);
  auth = $inject(ReactAuth);
  meRouter = $inject(MeRouter);
  realmApi = $client<RealmController>();

  head = $head(() => {
    const head: Head = {
      title: "Alepha Lore",
      description:
        "Alepha Lore - project and knowledge management for builders.",
    };

    head.link = [
      {
        rel: "icon",
        href: "/favicon.png",
        type: "image/png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        rel: "icon",
        href: "/favicon-light.png",
        type: "image/png",
        media: "(prefers-color-scheme: light)",
      },
      { rel: "manifest", href: "/manifest.json" },
    ];

    head.meta = [
      { name: "theme-color", content: "#010409" },
      {
        name: "keywords",
        content:
          "Alepha Lore, project management, task tracking, knowledge management, MCP, AI, quests, open-source",
      },
    ];

    return head;
  });

  layout = $page({
    children: () => [
      this.home,
      this.login,
      this.oauthContinue,
      this.register,
      this.resetPassword,
      this.project,
      this.projectCreate,
      this.projectFeedbackRequest,
      this.meRouter.me,
      this.notFound,
    ],
    ssr: false,
    lazy: () => import("./components/Layout.tsx"),
    loader: async ({ user }) => {
      if (user) {
        this.alepha.store.set(
          userProjectsAtom,
          await this.projectApi.getHomeOverview(),
        );
      }
    },
    errorHandler: (error, state) => {
      if (HttpError.is(error, 401) && state.url.pathname !== "/auth/login") {
        return new Redirection(
          `/auth/login?redirect=${encodeURIComponent(state.url.pathname)}`,
        );
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
    head: { title: "Sign in › Alepha Lore" },
    lazy: () => import("./components/auth/AuthLoginPage.tsx"),
    loader: async ({ query }) => {
      // OAuth bridge. The Alepha OAuth `authorize` endpoint redirects
      // unauthenticated users here with `?redirect_uri=`, but `AuthLogin`
      // reads `?redirect` and SPA-pushes to it after sign-in — and an SPA push
      // cannot reach the server-rendered `/oauth/authorize` route.
      // Translate the param and aim `?redirect` at the `/oauth/continue` bridge
      // page, which hard-navigates back into `authorize` once authenticated.
      const redirectUri = query.redirect_uri;
      if (
        typeof redirectUri === "string" &&
        redirectUri.startsWith("/oauth/authorize") &&
        !query.redirect
      ) {
        const bridge = `/oauth/continue?to=${encodeURIComponent(redirectUri)}`;
        throw new Redirection(
          `/auth/login?redirect=${encodeURIComponent(bridge)}`,
        );
      }
      const realmConfig = await this.realmApi.getRealmConfig();
      return { realmConfig };
    },
  });

  oauthContinue = $page({
    path: "/oauth/continue",
    name: "oauthContinue",
    head: { title: "Connecting › Alepha Lore" },
    lazy: () => import("./components/auth/OAuthContinuePage.tsx"),
  });

  register = $page({
    path: "/auth/register",
    name: "register",
    head: { title: "Sign up › Alepha Lore" },
    lazy: () => import("./components/auth/AuthRegisterPage.tsx"),
    loader: async () => {
      const realmConfig = await this.realmApi.getRealmConfig();
      return { realmConfig };
    },
  });

  resetPassword = $page({
    path: "/auth/reset-password",
    name: "resetPassword",
    head: { title: "Reset password › Alepha Lore" },
    lazy: () => import("./components/auth/AuthResetPasswordPage.tsx"),
    loader: async () => {
      const realmConfig = await this.realmApi.getRealmConfig();
      return { realmConfig };
    },
  });

  home = $page({
    path: "/",
    // Server-render the landing page (overrides the layout's `ssr: false`) so
    // the locale-prefixed `/` and `/fr/` URLs ship real HTML + hreflang
    // alternates to crawlers.
    ssr: true,
    animation: (state) => {
      if (state.url.pathname === "/new-project") {
        return {
          exit: { name: "fadeScaleOut", duration: 700, timing: "ease-in" },
        };
      }
    },
    lazy: () => import("./components/home/Home.tsx"),
  });

  projectCreate = $page({
    path: "/new-project",
    head: { title: "New project › Alepha Lore" },
    animation: {
      enter: { name: "fadeIn", duration: 500, timing: "ease-out" },
    },
    lazy: () => import("./components/project/ProjectCreate.tsx"),
  });

  project = $page({
    children: () => [
      this.projectQuests,
      this.projectQuest,
      this.projectQuestGraph,
      this.projectMilestones,
      this.projectSettings,
      this.projectReports,
      this.projectFolios,
      this.projectFeedback,
      this.projectBlights,
      this.projectApp,
    ],
    path: "/p/:projectId",
    schema: {
      params: z.object({
        projectId: z.integer(),
      }),
    },
    head: (props) => {
      const project = (props as { project?: { title?: string } } | undefined)
        ?.project;
      return { title: project?.title ?? "Project" };
    },
    animation: ({ meta }) => {
      if (meta.firstOpen) {
        return {
          enter: {
            name: "projectOpen",
            duration: 500,
            timing: "cubic-bezier(0.16, 1, 0.3, 1)",
          },
        };
      }
    },
    lazy: () => import("./components/project/ProjectView.tsx"),
    loader: async ({ params }) => {
      const { member, quests, ...project } =
        await this.projectApi.getProjectById({
          params: {
            id: params.projectId,
          },
        });

      const milestones = await this.milestoneApi.getMilestones({
        params: { projectId: params.projectId },
      });

      // Pending-feedback count for the sidebar badge. Fetched once per
      // project navigation instead of polled — accept/reject/remove
      // actions adjust the atom locally, so within-session math stays
      // correct. Errors leave the count undefined (badge hides).
      const pendingFeedback = await this.feedbackApi
        .listFeedback({
          params: { projectId: params.projectId },
          query: { status: "pending" },
        })
        .then((r) => r.items.length)
        .catch(() => 0);

      // Open-blight count for the sidebar badge. Member-readable; `.catch`
      // keeps a transient error from blocking the whole project load
      // (badge just hides).
      const openBlights = project.features?.blights
        ? await this.blightApi
            .countOpenBlights({ params: { projectId: params.projectId } })
            .then((r) => r.count)
            .catch(() => 0)
        : 0;

      // Open-quest count for the sidebar badge. Always on (unlike Blights /
      // Feedback, Quests has no feature gate) and member-readable; `.catch`
      // keeps a transient error from blocking the whole project load
      // (badge just hides).
      const openQuests = await this.questApi
        .countOpenQuests({ params: { projectId: params.projectId } })
        .then((r) => r.count)
        .catch(() => 0);

      // The sidebar's Apps section. Member-readable — `listSigils` is gated on
      // `project:read`, unlike every sigil mutation, which is owner-only — but
      // `.catch` keeps a transient failure from taking the whole project down
      // with it: a degraded section costs a section, an unhandled rejection
      // costs the page.
      //
      // `undefined` on failure, NOT `[]`: the section says "Enrol an app" for
      // an empty project, and telling a member whose read just failed that
      // their project has no apps is a lie with a call to action attached.
      const sigils = project.features?.sigils
        ? await this.sigilApi
            .listSigils({ params: { projectId: params.projectId } })
            .then((r) => r.items)
            .catch(() => undefined)
        : [];

      this.alepha.store.set(currentProjectAtom, project);
      this.alepha.store.set(currentProjectMemberAtom, member);
      this.alepha.store.set(currentAssignedQuestsAtom, quests);
      this.alepha.store.set(currentMilestonesAtom, milestones);
      this.alepha.store.set(currentFeedbackCountAtom, {
        count: pendingFeedback,
      });
      this.alepha.store.set(currentBlightCountAtom, { count: openBlights });
      this.alepha.store.set(currentQuestCountAtom, { count: openQuests });
      this.alepha.store.set(currentSigilsAtom, sigils);

      return {
        project,
      };
    },
    onLeave: () => {
      this.alepha.store.set(currentProjectMemberAtom, undefined);
      this.alepha.store.set(currentProjectAtom, undefined);
      this.alepha.store.set(currentAssignedQuestsAtom, []);
      this.alepha.store.set(currentMilestonesAtom, undefined);
      this.alepha.store.set(currentFeedbackCountAtom, { count: 0 });
      this.alepha.store.set(currentBlightCountAtom, { count: 0 });
      this.alepha.store.set(currentQuestCountAtom, { count: 0 });
      this.alepha.store.set(currentSigilsAtom, undefined);
    },
  });

  projectBlights = $page({
    name: "projectBlights",
    path: "/blights",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Blights`,
    }),
    lazy: () => import("./components/project/blights/ProjectBlights.tsx"),
    loader: async () => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }
      // Gate purely on the module toggle — no paywall.
      if (!project.features?.blights) {
        throw new NotFoundError("Blights not enabled for this project");
      }
      const res = await this.blightApi.listBlights({
        params: { projectId: project.id },
        query: {},
      });
      this.alepha.store.set(currentBlightCountAtom, {
        count: res.openCount,
      });
      return { items: res.items, openCount: res.openCount };
    },
  });

  /**
   * One enrolled app — the tab shell, and the loader every tab under it reads.
   *
   * ⚠️ The path segment is `:sigilId`, not `:id`, and that is load-bearing.
   * `/p/:projectId` is already a param node at an outer position, and the
   * router keeps one key per position: two routes naming different segments
   * `id` collapse onto one, the outer one wins, and the inner param arrives
   * missing. The API path (`/projects/:projectId/sigils/:sigilId`) names it the
   * same way for the same reason.
   */
  projectApp = $page({
    name: "projectApp",
    path: "/apps/:sigilId",
    children: () => [
      this.app,
      this.appAnalytics,
      this.appPerformance,
      this.appErrors,
      this.appSettings,
    ],
    schema: {
      params: z.object({
        sigilId: z.uuid(),
      }),
    },
    head: (props, previous) => {
      const sigil = (props as { sigil?: { name?: string } } | undefined)?.sigil;
      return { title: `${previous?.title ?? ""} › ${sigil?.name ?? "App"}` };
    },
    lazy: () => import("./components/project/apps/AppLayout.tsx"),
    loader: async ({ params }) => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }
      // The module toggle is the whole gate — the nav section is hidden on the
      // same flag, so reaching this by URL with it off is a 404, not a 403.
      if (!project.features?.sigils) {
        throw new NotFoundError("Sigils not enabled for this project");
      }

      // The list is the membership proof as well as the lookup: it is scoped to
      // the project server-side, so an id that is not in it does not belong
      // here, whoever it belongs to. Re-setting the atom also refreshes the
      // sidebar when this page is deep-linked into (the project loader's own
      // fetch may have failed, or another tab may have enrolled since).
      const { items } = await this.sigilApi.listSigils({
        params: { projectId: project.id },
      });
      const sigil = items.find((it) => it.id === params.sigilId);
      if (!sigil) {
        throw new NotFoundError("App not found");
      }
      this.alepha.store.set(currentSigilsAtom, items);
      this.alepha.store.set(currentSigilAtom, sigil);

      // Beacon off means there is nothing collected to read, and the three
      // tabs that would show it are not rendered. The app still has a page.
      if (project.features?.beacon) {
        this.alepha.store.set(
          currentSigilInsightsAtom,
          await this.insightsApi.getInsights({
            params: { projectId: project.id },
            query: { range: "7d", sigilId: sigil.id },
          }),
        );
      } else {
        this.alepha.store.set(currentSigilInsightsAtom, undefined);
      }

      return { sigil };
    },
    onLeave: () => {
      this.alepha.store.set(currentSigilAtom, undefined);
      this.alepha.store.set(currentSigilInsightsAtom, undefined);
    },
    errorHandler: (error) => {
      if (HttpError.is(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
    },
  });

  app = $page({
    name: "app",
    path: "/",
    lazy: () => import("./components/project/apps/AppDashboard.tsx"),
  });

  appAnalytics = $page({
    name: "appAnalytics",
    path: "/analytics",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Analytics`,
    }),
    lazy: () => import("./components/project/apps/AppAnalytics.tsx"),
    loader: async () => {
      this.assertBeacon();
    },
  });

  appPerformance = $page({
    name: "appPerformance",
    path: "/performance",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Performance`,
    }),
    lazy: () => import("./components/project/apps/AppPerformance.tsx"),
    loader: async () => {
      this.assertBeacon();
    },
  });

  appErrors = $page({
    name: "appErrors",
    path: "/errors",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Errors`,
    }),
    lazy: () => import("./components/project/apps/AppErrors.tsx"),
    loader: async () => {
      this.assertBeacon();
    },
  });

  appSettings = $page({
    name: "appSettings",
    path: "/settings",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Settings`,
    }),
    lazy: () => import("./components/project/apps/AppSettings.tsx"),
  });

  /**
   * The gate the three analytics tabs share.
   *
   * A 404 rather than a 403, for the same reason the deleted project-level
   * Insights route was: the tab is hidden on this exact flag, so reaching it by
   * URL with Beacon off is asking for a page that does not exist here, not
   * asking for one that is withheld.
   */
  protected assertBeacon(): void {
    const project = this.alepha.store.get(currentProjectAtom);
    if (!project?.features?.beacon) {
      throw new NotFoundError("Beacon not enabled for this project");
    }
  }

  projectQuests = $page({
    path: "/",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Quests`,
    }),
    lazy: () => import("./components/project/ProjectQuestsPage.tsx"),
  });

  projectMilestones = $page({
    path: "/milestones",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Milestones`,
    }),
    lazy: () => import("./components/project/milestones/ProjectMilestones.tsx"),
  });

  projectFeedback = $page({
    name: "projectFeedback",
    path: "/feedback",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Feedback`,
    }),
    lazy: () => import("./components/project/feedback/ProjectFeedback.tsx"),
    loader: async () => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }
      const { items } = await this.feedbackApi.listFeedback({
        params: { projectId: project.id },
        query: { status: "pending" },
      });
      return { items };
    },
  });

  projectReports = $page({
    path: "/reports",
    children: () => [
      this.reportsOverview,
      this.reportsQuests,
      this.reportsMembers,
    ],
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Reports`,
    }),
    lazy: () => import("./components/project/reports/ReportsLayout.tsx"),
  });

  reportsOverview = $page({
    name: "reportsOverview",
    path: "/",
    lazy: () => import("./components/project/reports/ReportsOverview.tsx"),
    loader: async () => ({
      overview: await this.projectReportsApi.getReportsOverview({
        params: {
          id: this.alepha.store.get(currentProjectAtom)?.id ?? -1,
        },
      }),
    }),
  });

  reportsQuests = $page({
    name: "reportsQuests",
    path: "/quests",
    lazy: () => import("./components/project/reports/ReportsQuests.tsx"),
    loader: async () => ({
      quests: await this.projectReportsApi.getReportsQuests({
        params: {
          id: this.alepha.store.get(currentProjectAtom)?.id ?? -1,
        },
      }),
    }),
  });

  reportsMembers = $page({
    name: "reportsMembers",
    path: "/members",
    lazy: () => import("./components/project/reports/ReportsMembers.tsx"),
    loader: async () => ({
      members: await this.projectReportsApi.getReportsMembers({
        params: {
          id: this.alepha.store.get(currentProjectAtom)?.id ?? -1,
        },
      }),
    }),
  });

  projectSettings = $page({
    path: "/settings",
    children: () => [
      this.projectSettingsBanner,
      this.projectSettingsMembers,
      this.projectSettingsZones,
      this.projectSettingsKanban,
      this.projectSettingsFolios,
      this.projectSettingsSigils,
      this.projectSettingsMilestones,
      this.projectSettingsQuests,
    ],
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Settings`,
    }),
    lazy: () => import("./components/project/settings/ProjectSettings.tsx"),
  });

  projectSettingsBanner = $page({
    name: "projectSettingsBanner",
    path: "/",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › General`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsGeneralPage.tsx"),
  });

  projectSettingsMembers = $page({
    name: "projectSettingsMembers",
    path: "/members",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Members`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsMembersPage.tsx"),
    loader: async () => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }
      const [members, pendingInvitations] = await Promise.all([
        this.projectApi.getProjectMembers({
          params: { id: project.id },
        }),
        this.invitationApi
          .listProjectInvitations({ params: { projectId: project.id } })
          .catch(() => []),
      ]);
      return { members, pendingInvitations };
    },
  });

  projectSettingsZones = $page({
    name: "projectSettingsZones",
    path: "/zones",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Zones`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsZonesPage.tsx"),
    loader: async () => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }
      const zones = await this.projectApi.getZones({
        params: { id: project.id },
      });
      return { zones };
    },
  });

  projectSettingsKanban = $page({
    name: "projectSettingsKanban",
    path: "/kanban",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Kanban`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsKanbanPage.tsx"),
  });

  projectSettingsFolios = $page({
    name: "projectSettingsFolios",
    path: "/folios",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Folios`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsFoliosPage.tsx"),
  });

  /**
   * Sigils — which applications report here.
   *
   * ⚠️ Named in `ProjectSettings.tsx`'s nav array, which is a list of route
   * names with nothing in the type system tying it to the routes it names.
   * Renaming or removing this page without editing that array crashes every
   * settings page, which is exactly what happened once.
   */
  projectSettingsSigils = $page({
    name: "projectSettingsSigils",
    path: "/sigils",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Sigils`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsSigilsPage.tsx"),
  });

  projectSettingsMilestones = $page({
    name: "projectSettingsMilestones",
    path: "/milestones",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Milestones`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsMilestonesPage.tsx"),
  });

  projectSettingsQuests = $page({
    name: "projectSettingsQuests",
    path: "/quests",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Quests`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsQuestsPage.tsx"),
  });

  projectQuest = $page({
    path: "/q/:shortId",
    schema: {
      params: z.object({
        shortId: z.integer(),
      }),
    },
    head: (props, previous) => {
      const questTitle = (props as { quest?: { title?: string } } | undefined)
        ?.quest?.title;
      return {
        title: `${previous?.title ?? ""} › ${questTitle ?? "Quest"}`,
      };
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
    lazy: () => import("./components/project/quest/QuestView.tsx"),
    loader: async ({ params }) => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }
      const quest = await this.questApi.getQuestByShortId({
        params: {
          projectId: project.id,
          shortId: params.shortId,
        },
      });
      this.alepha.store.set(currentQuestAtom, quest);
      return { quest };
    },
    onLeave: () => {
      this.alepha.store.set(currentQuestAtom, undefined);
    },
    errorHandler: (error) => {
      if (HttpError.is(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
    },
  });

  // Quest dependency graph page (Lore #98). Focused quest's connected
  // `dependsOn` component, dagre-laid-out, polled every 60s.
  projectQuestGraph = $page({
    name: "projectQuestGraph",
    path: "/q/:shortId/graph",
    schema: {
      params: z.object({
        shortId: z.integer(),
      }),
    },
    head: (props, previous) => {
      const quest = (props as { quest?: { title?: string } } | undefined)
        ?.quest;
      return {
        title: `${previous?.title ?? ""} › ${quest?.title ?? "Quest"} › Graph`,
      };
    },
    lazy: () => import("./components/project/quest/QuestGraph.tsx"),
    loader: async ({ params }) => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }
      const quest = await this.questApi.getQuestByShortId({
        params: {
          projectId: project.id,
          shortId: params.shortId,
        },
      });
      return { quest };
    },
    errorHandler: (error) => {
      if (HttpError.is(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
    },
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Folios — project-scoped markdown notes ("folios")
  // -------------------------------------------------------------------------------------------------------------------

  // Quest #66 originally split this from the entity-level "folios" naming
  // by giving it its own URL path (/archive), when the directory tree +
  // blobs were a distinct "Archive" module. The 2026-08 great rename
  // (Task 5) folded that module back into Folios — entities, MCP tools,
  // and now the URL path are all "folio(s)"-named again. Internal route
  // name stays `projectFolios`, unchanged since before quest #66.
  projectFolios = $page({
    name: "projectFolios",
    children: () => [this.projectFoliosNew, this.projectFoliosFolio],
    path: "/folios",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Folios`,
    }),
    lazy: () => import("./components/folios/FoliosLayout.tsx"),
    loader: async ({ url }) => {
      const project = this.alepha.store.get(currentProjectAtom);
      const projectId = project?.id;
      if (projectId === undefined) {
        throw new NotFoundError("Project not found");
      }
      // Resolve `?dir=<shortId>` → directoryId for the contents fetch.
      // Stale dir (deleted directory) falls back to root.
      let parentId: string | undefined;
      const dirParam = url.searchParams.get("dir");
      if (dirParam) {
        const shortId = Number.parseInt(dirParam, 10);
        if (Number.isFinite(shortId)) {
          try {
            const dir = await this.directoryApi.getDirectoryByShortId({
              params: { projectId, shortId },
            });
            parentId = dir.id;
          } catch {
            parentId = undefined;
          }
        }
      }
      // Three parallel fetches: directory contents (table data),
      // folios (tag autocomplete on the editor), tag set (sidebar tag
      // cloud — still referenced by older code paths).
      const [contents, folios, tags] = await Promise.all([
        this.directoryApi.listContents({
          params: { projectId },
          query: { parentId },
        }),
        this.folioApi.list({ query: { limit: 100, projectId } }),
        this.folioApi.listTags({ query: { projectId } }),
      ]);
      this.alepha.store.set(userFoliosAtom, folios);
      this.alepha.store.set(folioTagsAtom, tags);
      this.alepha.store.set(currentFolioContentsAtom, contents);
      // Populate the folio breadcrumb (Lore › Folios › <dirs…>)
      // before the page renders. FolioBrowser keeps the atom in sync
      // on subsequent in-page navigations.
      const segments = [
        ...contents.breadcrumb.map((b) => ({
          name: b.name,
          shortId: b.shortId,
        })),
      ];
      if (contents.directory) {
        segments.push({
          name: contents.directory.name,
          shortId: contents.directory.shortId,
        });
      }
      this.alepha.store.set(currentFolioPathAtom, segments);
    },
    onLeave: () => {
      this.alepha.store.set(currentFolioAtom, undefined);
      this.alepha.store.set(currentFolioPathAtom, []);
      this.alepha.store.set(currentFolioContentsAtom, undefined);
    },
  });

  projectFoliosNew = $page({
    name: "projectFoliosNew",
    path: "/new",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › New`,
    }),
    lazy: () => import("./components/folios/FolioCreatePage.tsx"),
    loader: async ({ url }) => {
      this.alepha.store.set(currentFolioAtom, undefined);
      // Carry the source directory across the navigation: FolioBrowser's
      // "+ Create → New folio" link adds `?dir=<shortId>` when the user
      // is in a directory; resolve to a UUID here so the editor can pass
      // it to `folioApi.create({ directoryId })`. Without this, every
      // folio created from this page lands at the project root
      // regardless of the directory the user clicked from.
      const dirParam = url.searchParams.get("dir");
      const project = this.alepha.store.get(currentProjectAtom);
      let directoryId: string | undefined;
      if (dirParam && project) {
        const shortId = Number.parseInt(dirParam, 10);
        if (Number.isFinite(shortId)) {
          try {
            const dir = await this.directoryApi.getDirectoryByShortId({
              params: { projectId: project.id, shortId },
            });
            directoryId = dir.id;
          } catch {
            // Stale `?dir` — fall back to root.
            directoryId = undefined;
          }
        }
      }
      return { directoryId };
    },
  });

  projectFoliosFolio = $page({
    name: "projectFoliosFolio",
    path: "/:shortId",
    schema: {
      params: z.object({ shortId: z.integer() }),
    },
    head: (props, previous) => {
      const folio = (
        props as
          | {
              folio?: {
                title?: string;
                metadata?: { path?: { name: string }[] };
              };
            }
          | undefined
      )?.folio;
      const path = folio?.metadata?.path ?? [];
      const dirPrefix =
        path.length > 0 ? `${path.map((p) => p.name).join("/")}/` : "";
      return {
        title: `${previous?.title ?? ""} › ${dirPrefix}${folio?.title ?? "Folio"}`,
      };
    },
    lazy: () => import("./components/folios/editor/FolioWorkspace.tsx"),
    loader: async ({ params }) => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }
      // Three calls in one tick → alepha auto-batches them into a
      // single `/api/_batch` round-trip. Folio (page subject), folio
      // list + directory list (the workspace's tree pane, Task 9)
      // all arrive in one network hit, sparing the pane its own
      // mount-time fetch. See Lore #109.
      const [folio, folios, directories] = await Promise.all([
        this.folioApi.getByShortId({
          params: { projectId: project.id, shortId: params.shortId },
          query: { withLinks: true, withPath: true },
        }),
        this.folioApi.list({ query: { projectId: project.id, limit: 100 } }),
        this.directoryApi.listAllDirectories({
          params: { projectId: project.id },
        }),
      ]);
      this.alepha.store.set(currentFolioAtom, folio);
      this.alepha.store.set(userFoliosAtom, folios);
      this.alepha.store.set(projectDirectoriesAtom, directories);
      // Populate the folio breadcrumb so the AppShell header reads
      // "Lore › Folios › <dirs…> › <folio title>". Cleared on leave
      // by the parent `projectFolios` route.
      const path = folio.metadata?.path ?? [];
      this.alepha.store.set(currentFolioPathAtom, [
        ...path,
        { name: folio.title },
      ]);
      return { folio };
    },
  });

  projectFeedbackRequest = $page({
    name: "projectFeedbackRequest",
    path: "/p/:projectId/request",
    schema: {
      params: z.object({ projectId: z.integer() }),
    },
    head: { title: "Submit feedback › Alepha Lore" },
    ssr: false,
    lazy: () =>
      import("./components/project/feedback/ProjectFeedbackRequest.tsx"),
  });

  notFound = $page({
    path: "/*",
    component: NotFound,
  });
}
