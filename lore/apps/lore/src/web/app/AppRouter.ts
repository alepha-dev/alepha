import { AccountRouter } from "@alepha/ui/components/account/account-router";
import { $hook, $inject, Alepha, z } from "alepha";
import type { RealmController } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { ReactAuth } from "alepha/react/auth";
import { $head, type Head } from "alepha/react/head";
import { $page, NotFound, ReactRouter, Redirection } from "alepha/react/router";
import { $secure, currentUserAtom } from "alepha/security";
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
import { currentFolioBlobsAtom } from "./atoms/currentFolioBlobsAtom.ts";
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
import { folioTreeSeedAtom } from "./atoms/folioTreeSeedAtom.ts";
import { projectDirectoriesAtom } from "./atoms/projectDirectoriesAtom.ts";
import { userFoliosAtom } from "./atoms/userFoliosAtom.ts";
import { userProjectsAtom } from "./atoms/userProjectsAtom.ts";
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
  account = $inject(AccountRouter);
  realmApi = $client<RealmController>();
  dateTime = $inject(DateTimeProvider);

  /**
   * How long a folio-tree seed stays usable. Matches the `staleTime` on
   * `useFolioTreeModel`'s fallback query so both halves of the tree's
   * freshness policy say the same thing.
   */
  protected static readonly FOLIO_TREE_TTL_MS = 30_000;

  /**
   * Fill `userFoliosAtom` + `projectDirectoriesAtom` — the two lists the
   * folio tree pane renders from — unless they already hold this
   * project's rows and were filled recently. See `folioTreeSeedAtom` for
   * why the unconditional fetch these loaders used to do was two wasted
   * HTTP calls per folio opened.
   *
   * Deliberately does no `await` before deciding: callers put it in a
   * `Promise.all` next to their own fetch, and anything awaited ahead of
   * the decision would push these calls into a later tick and out of the
   * `BatchCollector` window they need to share.
   */
  protected async seedFolioTree(projectId: number): Promise<void> {
    const seed = this.alepha.store.get(folioTreeSeedAtom);
    const now = this.dateTime.nowMillis();
    if (
      seed &&
      seed.projectId === projectId &&
      now - seed.at < AppRouter.FOLIO_TREE_TTL_MS
    ) {
      return;
    }
    const [folios, directories] = await Promise.all([
      this.folioApi.list({ query: { projectId, limit: 100 } }),
      this.directoryApi.listAllDirectories({ params: { projectId } }),
    ]);
    this.alepha.store.set(userFoliosAtom, folios);
    this.alepha.store.set(projectDirectoriesAtom, directories);
    this.alepha.store.set(folioTreeSeedAtom, { projectId, at: now });
  }

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
      this.account.layout,
      this.notFound,
    ],
    // No `ssr` here on purpose. The shell is shared by anonymous pages (home,
    // login, register) and guarded ones, so the rendering mode belongs to each
    // page: the guarded ones carry `$secure` and derive CSR from it, and the
    // public ones keep real HTML for crawlers.
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
    use: [$secure()],
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
    /**
     * A **root-level** param: `/sds/quests/19`, not `/p/2/q/19`.
     *
     * The router walks static children before the param child and backtracks on
     * failure (`RouterProvider.search`), so `/auth/login`, `/new-project` and
     * `/oauth/continue` still win over this. `test/app-routes.spec.ts` asserts
     * every static root segment is also reserved in `ProjectSlugService`, so a
     * project can never claim one.
     *
     * ⚠️ The param is `projectSlug` here and in `projectFeedbackRequest`, which
     * shares this tree position. `RouterProvider.push` keeps ONE param name per
     * position — two routes naming it differently collapse onto one, the outer
     * wins, and the inner value arrives missing. Same trap documented on
     * `projectApp`'s `:appName`.
     */
    path: "/:projectSlug",
    // Every project surface is member-gated server-side, so nothing under here
    // is reachable anonymously. The guard turns an anonymous visitor away at the
    // router (instead of letting the loader 401 and the errorHandler catch it),
    // and puts the whole subtree in CSR — no HTML render a crawler will ever see.
    //
    // Consequence of the root-level param: an anonymous visitor who mistypes ANY
    // path now lands on the login page rather than a 404, because `/tpyo` matches
    // here. Unavoidable without a database round-trip ahead of the guard. A
    // signed-in visitor still gets a real 404 — see `errorHandler` below.
    use: [$secure()],
    schema: {
      params: z.object({
        projectSlug: z.string(),
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
      // The one slug→id resolution in the app. Every fetch below — and every
      // endpoint any page under this layout calls — still takes the integer
      // id, read off `currentProjectAtom`. That is what keeps slug routing out
      // of the rest of the API surface.
      const { member, quests, ...project } =
        await this.projectApi.getProjectBySlug({
          params: {
            slug: params.projectSlug,
          },
        });

      const milestones = await this.milestoneApi.getMilestones({
        params: { projectId: project.id },
      });

      // Pending-feedback count for the sidebar badge. Fetched once per
      // project navigation instead of polled — accept/reject/remove
      // actions adjust the atom locally, so within-session math stays
      // correct. Errors leave the count undefined (badge hides).
      const pendingFeedback = await this.feedbackApi
        .listFeedback({
          params: { projectId: project.id },
          query: { status: "pending" },
        })
        .then((r) => r.items.length)
        .catch(() => 0);

      // Open-quest count for the sidebar badge. Always on (unlike Blights /
      // Feedback, Quests has no feature gate) and member-readable; `.catch`
      // keeps a transient error from blocking the whole project load
      // (badge just hides).
      const openQuests = await this.questApi
        .countOpenQuests({ params: { projectId: project.id } })
        .then((r) => r.count)
        .catch(() => 0);

      // The sidebar's Apps section. Member-readable — `listSigils` is gated on
      // `project:read`, unlike every sigil mutation, which is owner-only — but
      // `.catch` keeps a transient failure from taking the whole project down
      // with it: a degraded section costs a section, an unhandled rejection
      // costs the page.
      //
      // `undefined` on failure, NOT `[]`: the sidebar and the Blights
      // derivation below both need to tell "no apps" apart from "could not
      // read the apps" — see `currentSigilsAtom`.
      const sigils = project.features?.sigils
        ? await this.sigilApi
            .listSigils({ params: { projectId: project.id } })
            .then((r) => r.items)
            .catch(() => undefined)
        : [];

      // Open-blight count for the sidebar badge. Member-readable; `.catch`
      // keeps a transient error from blocking the whole project load
      // (badge just hides).
      //
      // Counted under the module's master switch alone, deliberately *not*
      // narrowed to "some enrolled app still carries the `blights` kind". A
      // blight outlives the credential that filed it — `blights.sigilId` is
      // `ON DELETE SET NULL` and rows survive for `retentionDays` — so an
      // owner who deletes their last app, or just switches Blights off on it,
      // still has an inbox full of open crashes. Deriving the count from the
      // apps would zero it in the same instant the sidebar entry vanished,
      // and `ProjectView` reads this count to keep that entry reachable.
      const openBlights = project.features?.sigils
        ? await this.blightApi
            .countOpenBlights({ params: { projectId: project.id } })
            .then((r) => r.count)
            .catch(() => 0)
        : 0;

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
    errorHandler: (error) => {
      // `/:projectSlug` matches any unclaimed root path, so a typo reaches this
      // route rather than `notFound`. Without this, a signed-in user who
      // mistypes a URL gets the layout's generic ErrorPage in production
      // instead of a 404. (An anonymous one is bounced to login by `$secure()`
      // before the loader runs at all — see the note on `use` above.)
      if (HttpError.is(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
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
      // Gated on the Apps master switch, not on whether any app currently
      // carries the Blights capability. Deriving it from the sigil list would
      // turn a transient `listSigils` failure into a 404 on a deep link, and an
      // inbox with nothing in it costs nothing. The sidebar entry is the one
      // that derives.
      if (!project.features?.sigils) {
        throw new NotFoundError("Apps are not enabled for this project");
      }
      // No fetch here on purpose. The page hands `listBlights` to an
      // `AlephaTable`, which owns paging/sort/filters and therefore always
      // issues its own call with its own query — so a copy fetched here was
      // read by nothing and thrown away on every visit. The badge does not
      // need it either: the parent `project` loader already seeds
      // `currentBlightCountAtom` via `countOpenBlights`, and the table
      // refreshes it a moment later.
      //
      // Nor can the two be merged: `$action` coalesces CONCURRENT calls into
      // `/api/_batch`, and these were sequential by construction — the loader
      // has to resolve before the page renders and the table mounts.
      //
      // The rule: a route loader fetches only what the page cannot fetch for
      // itself.
    },
  });

  /**
   * One enrolled app — the tab shell, and the loader every tab under it reads.
   *
   * The segment is the app's **name**, not its id: `/p/2/apps/lore-staging`.
   * Names are unique on `(projectId, name)` and constrained to
   * `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` on the way in (see `appNameSchema`), so
   * they survive a path unescaped. The HTTP API still addresses a sigil by
   * UUID — rotate, delete and `?sigilId=` are unchanged; only this page moved.
   *
   * ⚠️ The path segment is `:appName`, not `:id` or `:name`, and that is
   * load-bearing. `/p/:projectId` is already a param node at an outer position,
   * and the router keeps one key per position: two routes naming different
   * segments the same thing collapse onto one, the outer one wins, and the
   * inner param arrives missing.
   */
  projectApp = $page({
    name: "projectApp",
    path: "/apps/:appName",
    children: () => [
      this.app,
      this.appAnalytics,
      this.appPerformance,
      this.appSettings,
    ],
    schema: {
      params: z.object({
        appName: z.string(),
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
      const sigil = items.find((it) => it.name === params.appName);
      if (!sigil) {
        throw new NotFoundError("App not found");
      }
      this.alepha.store.set(currentSigilsAtom, items);
      this.alepha.store.set(currentSigilAtom, sigil);

      // The app's own Beacon capability, not the project's. Off means there is
      // nothing collected to read, and the three tabs that would show it are
      // not rendered. The app still has a page.
      if (sigil.kinds.includes("beacon")) {
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
   * Reads the open app rather than the project: Beacon is a per-app capability
   * now. A 404 rather than a 403, for the same reason the deleted project-level
   * Insights route was — the tab is hidden on this exact condition, so reaching
   * it by URL with Beacon off is asking for a page that does not exist here,
   * not one that is withheld.
   */
  protected assertBeacon(): void {
    const sigil = this.alepha.store.get(currentSigilAtom);
    if (!sigil?.kinds.includes("beacon")) {
      throw new NotFoundError("Beacon is not enabled for this app");
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
      this.projectSettingsAreas,
      this.projectSettingsKanban,
      this.projectSettingsFolios,
      this.projectSettingsFeedback,
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

  projectSettingsAreas = $page({
    name: "projectSettingsAreas",
    path: "/areas",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Areas`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsAreasPage.tsx"),
    loader: async () => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }
      const areas = await this.projectApi.getAreas({
        params: { id: project.id },
      });
      return { areas };
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

  projectSettingsFeedback = $page({
    name: "projectSettingsFeedback",
    path: "/feedback",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Feedback`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsFeedbackPage.tsx"),
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
    path: "/quests/:shortId",
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
    path: "/quests/:shortId/graph",
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
    loader: async () => {
      const project = this.alepha.store.get(currentProjectAtom);
      const projectId = project?.id;
      if (projectId === undefined) {
        throw new NotFoundError("Project not found");
      }
      // The tag set (the editor's tag autocomplete) plus the tree's own
      // two lists, which `seedFolioTree` owns — the folio list AND the
      // directory list, the latter load-bearing: the tree's fallback
      // `useQuery` is gated on `enabled: !seeded`, where "seeded" is
      // satisfied by `userFoliosAtom` ALONE. Any project with at least one
      // folio therefore looked seeded the moment the folio list resolved,
      // the fallback never ran, and a hard load of `/folios` rendered a
      // tree with no directories in it — every nested folio flat at the
      // root.
      //
      // The directory-contents fetch and the `?dir=` resolution that used
      // to sit here went with `FolioBrowser` — they existed to fill its
      // table and its breadcrumb. A folio page sets its own breadcrumb
      // from the folio's `metadata.path`, so nothing downstream reads
      // them any more.
      const [tags] = await Promise.all([
        this.folioApi.listTags({ query: { projectId } }),
        this.seedFolioTree(projectId),
      ]);
      this.alepha.store.set(folioTagsAtom, tags);
      // `/folios` itself is just "Folios" in the header — a folio page
      // appends its own directory chain and title when it loads.
      this.alepha.store.set(currentFolioPathAtom, []);
    },
    onLeave: () => {
      this.alepha.store.set(currentFolioAtom, undefined);
      this.alepha.store.set(currentFolioPathAtom, []);
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
      // Populate the tree's lists so the document workspace's meta bar
      // (Task 8) can resolve the create-mode `directoryId` above to a
      // display name — the chip shows where the new folio WILL land, even
      // though it's not clickable yet (there's no row for `folio.move` to
      // act on until the folio is saved). Landing directly on
      // `/folios/new` (rather than navigating here from `/folios`)
      // previously left `projectDirectoriesAtom` unset or stale from a
      // prior folio view. Going through `seedFolioTree` also fills
      // `userFoliosAtom`, which this loader never did and which the tree
      // pane's `enabled: !seeded` fallback then had to fetch on mount.
      if (project) {
        await this.seedFolioTree(project.id);
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
      // ONE call opens a folio. Everything the workspace needs that keys
      // off the folio itself — its links, its directory chain, its
      // attachments, its revision count — is asked for on the folio
      // request, because each of those used to be a follow-up round-trip
      // that could only START once this one had resolved (they address
      // the folio by `id`, and the URL only carries `shortId`). Sitting
      // after the `await`, they were far past the 10ms `BatchCollector`
      // window and could never join it. See Lore #109.
      //
      // `seedFolioTree` rides alongside and is usually a no-op: the
      // `/folios` layout loader that necessarily ran before this one
      // already filled the tree's lists, and a layout loader is not
      // re-run on child navigation. When it does have to fetch, it does
      // so in this same tick and batches with the folio.
      const [folio] = await Promise.all([
        this.folioApi.getByShortId({
          params: { projectId: project.id, shortId: params.shortId },
          query: {
            withLinks: true,
            withPath: true,
            withBlobs: true,
            withRevisionCount: true,
          },
        }),
        this.seedFolioTree(project.id),
      ]);
      this.alepha.store.set(currentFolioAtom, folio);
      this.alepha.store.set(currentFolioBlobsAtom, folio.metadata?.blobs ?? []);
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
    // Shares the root param node with `project`, so the param MUST be named
    // `projectSlug` here too — one name per tree position. Stays a top-level
    // route rather than a child of `project` so it keeps NO membership guard.
    path: "/:projectSlug/request",
    schema: {
      params: z.object({ projectSlug: z.string() }),
    },
    head: { title: "Submit feedback › Alepha Lore" },
    // Deliberately unguarded: an anonymous visitor gets the sign-in CTA rather
    // than a redirect, because this is the URL third-party "report a bug"
    // buttons link to. So it server-renders — the draft autofill it does on
    // mount is `useEffect`-only and survives hydration.
    lazy: () =>
      import("./components/project/feedback/ProjectFeedbackRequest.tsx"),
  });

  notFound = $page({
    path: "/*",
    component: NotFound,
  });
}
