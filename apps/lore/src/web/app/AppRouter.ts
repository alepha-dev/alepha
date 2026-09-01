import { AccountRouter } from "@alepha/ui/components/account/account-router";
import { $hook, $inject, Alepha, z } from "alepha";
import type { AdminInvitationController } from "alepha/api/invitations";
import type { RealmController } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { ReactAuth } from "alepha/react/auth";
import { $head, type Head } from "alepha/react/head";
import { $page, NotFound, ReactRouter, Redirection } from "alepha/react/router";
import { $secure, currentUserAtom } from "alepha/security";
import { HttpError, NotFoundError } from "alepha/server";
import { $client } from "alepha/server/links";
import { createElement } from "react";

import type { AreaController } from "../../api/controllers/AreaController.ts";
import type { BlightController } from "../../api/controllers/BlightController.ts";
import type { DashboardController } from "../../api/controllers/DashboardController.ts";
import type { DirectoryController } from "../../api/controllers/DirectoryController.ts";
import type { EpicController } from "../../api/controllers/EpicController.ts";
import type { FeedbackController } from "../../api/controllers/FeedbackController.ts";
import type { FolioController } from "../../api/controllers/FolioController.ts";
import type { InvitationController } from "../../api/controllers/InvitationController.ts";
import type { ProjectController } from "../../api/controllers/ProjectController.ts";
import type { ProjectReportsController } from "../../api/controllers/ProjectReportsController.ts";
import type { QualityController } from "../../api/controllers/QualityController.ts";
import type { QuestController } from "../../api/controllers/QuestController.ts";
import type { ReleaseController } from "../../api/controllers/ReleaseController.ts";
import type { SigilController } from "../../api/controllers/SigilController.ts";
import { currentAreasAtom } from "./atoms/currentAreasAtom.ts";
import { currentAssignedQuestsAtom } from "./atoms/currentAssignedQuestsAtom.ts";
import { currentBlightCountAtom } from "./atoms/currentBlightCountAtom.ts";
import { currentEpicAtom } from "./atoms/currentEpicAtom.ts";
import { currentEpicCountAtom } from "./atoms/currentEpicCountAtom.ts";
import { currentFeedbackCountAtom } from "./atoms/currentFeedbackCountAtom.ts";
import { currentFolioBlobsAtom } from "./atoms/currentFolioBlobsAtom.ts";
import { currentFolioPathAtom } from "./atoms/currentFolioPathAtom.ts";
import { currentProjectAtom } from "./atoms/currentProjectAtom.ts";
import { currentProjectMemberAtom } from "./atoms/currentProjectMemberAtom.ts";
import { currentQuestAtom } from "./atoms/currentQuestAtom.ts";
import { currentQuestCountAtom } from "./atoms/currentQuestCountAtom.ts";
import { currentReleasesAtom } from "./atoms/currentReleasesAtom.ts";
import { currentSigilAtom } from "./atoms/currentSigilAtom.ts";
import { currentSigilsAtom } from "./atoms/currentSigilsAtom.ts";
import { dashboardAtom } from "./atoms/dashboardAtom.ts";
import { folioTreeSeedAtom } from "./atoms/folioTreeSeedAtom.ts";
import { projectDirectoriesAtom } from "./atoms/projectDirectoriesAtom.ts";
import { realmSettingsAtom } from "./atoms/realmSettingsAtom.ts";
import { userFoliosAtom } from "./atoms/userFoliosAtom.ts";
import { userProjectsAtom } from "./atoms/userProjectsAtom.ts";
import ErrorPage from "./components/shared/ErrorPage.tsx";

/**
 * The leaderboards that have a detail page, which is exactly the set
 * `InsightsController.getInsightsDimension` accepts.
 *
 * Duplicated deliberately rather than imported from the controller: this file
 * ships to the browser, and importing a controller module would pull the
 * repositories and the database provider into the client bundle. `entryPath`
 * is in the list and is not a dataset dimension - it groups by `path` and
 * differs only in the measure, which is the distinction that makes a landing
 * page report possible at all.
 */
export const ANALYTICS_DIMENSIONS = new Set([
  "country",
  "path",
  "entryPath",
  "campaign",
  "device",
  "referrer",
  "browser",
  "os",
]);

export class AppRouter {
  alepha = $inject(Alepha);
  questApi = $client<QuestController>();
  projectApi = $client<ProjectController>();
  projectReportsApi = $client<ProjectReportsController>();
  qualityApi = $client<QualityController>();
  invitationAdminApi = $client<AdminInvitationController>();
  invitationApi = $client<InvitationController>();
  feedbackApi = $client<FeedbackController>();
  epicApi = $client<EpicController>();
  areaApi = $client<AreaController>();
  blightApi = $client<BlightController>();
  releaseApi = $client<ReleaseController>();
  sigilApi = $client<SigilController>();
  folioApi = $client<FolioController>();
  directoryApi = $client<DirectoryController>();
  dashboardApi = $client<DashboardController>();
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
    /**
     * The dashboard's card list, for a signed-in visitor.
     *
     * The CONFIGURATION only: the grid lays out with the right tiles, titles
     * and chips before a single number exists, and `Dashboard` resolves the
     * values itself once on mount. Splitting the two is what makes "loading"
     * a designed state rather than a blank page, and it keeps the metric
     * queries off the server-render path.
     *
     * This also seeds a brand-new account's default cards — see
     * `dashboardSettings` for why that happens exactly once and why an
     * emptied board stays empty.
     *
     * ⚠️ Fetched behind a `catch`: the cards are one section of the landing
     * page, and a transient failure must cost the dashboard, not Home. And it
     * runs on ENTRY only — a loader that revalidates on its own dependencies
     * is the QuestGraph incident (folio #1057).
     */
    loader: async ({ user }) => {
      if (!user) {
        // An anonymous visitor gets the hero, whose primary button is the
        // only thing on the page. Which button that should be depends on
        // whether signups are open, so the answer has to be here rather than
        // in a client fetch that lands after the first paint and swaps the
        // CTA under the cursor. `getRealmConfig` carries an `$etag`, so a
        // returning visitor pays a 304.
        const realmConfig = await this.realmApi
          .getRealmConfig()
          .catch(() => undefined);
        this.alepha.store.set(realmSettingsAtom, {
          registrationAllowed:
            realmConfig?.settings.registrationAllowed !== false,
        });
        return;
      }
      const dashboard = await this.dashboardApi
        .listCards({})
        .catch(() => undefined);
      if (dashboard) {
        this.alepha.store.set(dashboardAtom, { cards: dashboard.cards });
      }
    },
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
      this.projectKanban,
      this.projectQuest,
      this.projectQuestGraph,
      this.projectEpics,
      this.projectEpic,
      this.projectReleases,
      this.projectRelease,
      this.projectSettings,
      this.projectReports,
      this.projectFolios,
      this.projectFeedback,
      this.projectBlights,
      this.projectApps,
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

      // Everything below needs only `project.id`, so it is issued together
      // rather than awaited in turn. That is not just parallelism: the
      // browser's `BatchCollector` coalesces action calls raised within a
      // 10ms window into ONE `POST /api/_batch`, and sequential awaits can
      // never share a window because each blocks on a full round trip. As a
      // chain these were six requests deep on every project navigation; as
      // one `Promise.all` they are a single batched request, which is also
      // why adding the epic count below costs nothing.
      //
      // Rejection behaviour is unchanged: `getReleases` still has no
      // `.catch`, so a failure there rejects the loader exactly as it did
      // when it was awaited first.
      const [
        releases,
        pendingFeedback,
        openQuests,
        plannedEpics,
        sigils,
        openBlights,
        areas,
      ] = await Promise.all([
        this.releaseApi.getReleases({
          params: { projectId: project.id },
        }),

        // Pending-feedback count for the sidebar badge. Fetched once per
        // project navigation instead of polled: accept/reject/remove
        // actions adjust the atom locally, so within-session math stays
        // correct. Errors count as 0 (the badge hides).
        this.feedbackApi
          .listFeedback({
            params: { projectId: project.id },
            query: { status: "pending" },
          })
          .then((r) => r.items.length)
          .catch(() => 0),

        // Open-quest count for the sidebar badge. Always on (unlike Blights /
        // Feedback, Quests has no feature gate) and member-readable; `.catch`
        // keeps a transient error from blocking the whole project load
        // (badge just hides).
        this.questApi
          .countOpenQuests({ params: { projectId: project.id } })
          .then((r) => r.count)
          .catch(() => 0),

        // Planned-epic count for the sidebar badge. Gated on the same
        // `features.epics` switch that decides whether the entry renders at
        // all, so a project with epics off pays nothing for it.
        //
        // This is the counterweight to the quest count above: that one runs
        // the backlog gate, so quests parked inside a planned epic are
        // excluded from it on purpose. Without this number the sidebar
        // reported none of that work.
        project.features?.epics
          ? this.epicApi
              .countPlannedEpics({ params: { projectId: project.id } })
              .then((r) => r.count)
              .catch(() => 0)
          : Promise.resolve(0),

        // The sidebar's Apps section. Member-readable (`listSigils` is gated
        // on `project:read`, unlike every sigil mutation, which is owner-only)
        // but `.catch` keeps a transient failure from taking the whole
        // project down with it: a degraded section costs a section, an
        // unhandled rejection costs the page.
        //
        // `undefined` on failure, NOT `[]`: the sidebar and the Blights
        // derivation below both need to tell "no apps" apart from "could not
        // read the apps": see `currentSigilsAtom`.
        project.features?.sigils
          ? this.sigilApi
              .listSigils({ params: { projectId: project.id } })
              .then((r) => r.items)
              .catch(() => undefined)
          : Promise.resolve([]),

        // Open-blight count for the sidebar badge. Member-readable; `.catch`
        // keeps a transient error from blocking the whole project load
        // (badge just hides).
        //
        // Counted under the module's master switch alone, deliberately *not*
        // narrowed to "some enrolled app still carries the `blights` kind". A
        // blight outlives the credential that filed it: `blights.sigilId` is
        // `ON DELETE SET NULL` and rows survive for `retentionDays`, so an
        // owner who deletes their last app, or just switches Blights off on it,
        // still has an inbox full of open crashes. Deriving the count from the
        // apps would zero it in the same instant the sidebar entry vanished,
        // and `ProjectView` reads this count to keep that entry reachable.
        project.features?.sigils
          ? this.blightApi
              .countOpenBlights({ params: { projectId: project.id } })
              .then((r) => r.count)
              .catch(() => 0)
          : Promise.resolve(0),

        // The one list every area picker reads. Member-readable, and
        // `.catch` keeps a transient failure from taking the page down:
        // an empty picker costs a picker, an unhandled rejection costs the
        // project.
        this.areaApi
          .getAreas({ params: { projectId: project.id } })
          .catch(() => undefined),
      ]);

      this.alepha.store.set(currentProjectAtom, project);
      this.alepha.store.set(currentProjectMemberAtom, member);
      this.alepha.store.set(currentAssignedQuestsAtom, quests);
      this.alepha.store.set(currentReleasesAtom, releases);
      this.alepha.store.set(currentFeedbackCountAtom, {
        count: pendingFeedback,
      });
      this.alepha.store.set(currentBlightCountAtom, { count: openBlights });
      this.alepha.store.set(currentQuestCountAtom, { count: openQuests });
      this.alepha.store.set(currentEpicCountAtom, { count: plannedEpics });
      this.alepha.store.set(currentSigilsAtom, sigils);
      this.alepha.store.set(currentAreasAtom, areas);

      return {
        project,
      };
    },
    onLeave: () => {
      this.alepha.store.set(currentProjectMemberAtom, undefined);
      this.alepha.store.set(currentProjectAtom, undefined);
      this.alepha.store.set(currentAssignedQuestsAtom, []);
      this.alepha.store.set(currentReleasesAtom, undefined);
      this.alepha.store.set(currentFeedbackCountAtom, { count: 0 });
      this.alepha.store.set(currentBlightCountAtom, { count: 0 });
      this.alepha.store.set(currentQuestCountAtom, { count: 0 });
      this.alepha.store.set(currentEpicCountAtom, { count: 0 });
      this.alepha.store.set(currentSigilsAtom, undefined);
      this.alepha.store.set(currentAreasAtom, undefined);
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
   * The segment is the app's **name**, not its id: `/lore/apps/lore-staging`.
   * Names are unique on `(projectId, name)` and constrained to
   * `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` on the way in (see `appNameSchema`), so
   * they survive a path unescaped. The HTTP API still addresses a sigil by
   * UUID — rotate, delete and `?sigilId=` are unchanged; only this page moved.
   *
   * ⚠️ The path segment is `:appName`, not `:id` or `:name`, and that is
   * load-bearing. `/:projectSlug` is already a param node at an outer position,
   * and the router keeps one key per position: two routes naming different
   * segments the same thing collapse onto one, the outer one wins, and the
   * inner param arrives missing.
   */
  /**
   * Every enrolled app, in one table.
   *
   * Reachable only from the breadcrumb: the sidebar already carries an Apps
   * disclosure group with one child per app, so a list entry beside it would
   * be a second door to the same information. `SECTION_HREF_ROUTES` in
   * `ProjectView` is what turns the "Apps" crumb from dead text into a link.
   *
   * Gated on `features.sigils` the same way `projectApp` is, and for the same
   * reason: the module toggle is the whole gate, so reaching this by URL with
   * it off is a 404 rather than a 403.
   */
  projectApps = $page({
    name: "projectApps",
    path: "/apps",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Apps`,
    }),
    lazy: () => import("./components/project/apps/ProjectApps.tsx"),
    loader: async () => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project?.features?.sigils) {
        throw new NotFoundError("Sigils not enabled for this project");
      }
    },
    errorHandler: (error) => {
      if (HttpError.is(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
    },
  });

  projectApp = $page({
    name: "projectApp",
    path: "/apps/:appName",
    children: () => [
      this.app,
      this.appAnalytics,
      this.appAnalyticsDimension,
      this.appVitals,
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

      // Nothing analytics-shaped is fetched here. This loader runs for every
      // tab, Settings included, and it used to await a full `getInsights` —
      // ten aggregate queries against Analytics Engine — before any of them
      // rendered. The two tabs that show insights ask for them themselves
      // (`useAppInsights`), which is what makes the others free to open.
      return { sigil };
    },
    onLeave: () => {
      this.alepha.store.set(currentSigilAtom, undefined);
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

  /**
   * One leaderboard in full: where a card's "More" link goes.
   *
   * A SIBLING of `appAnalytics` rather than a child of it. A child would mean
   * `AppAnalytics` rendering a `NestedView`, which would draw the whole
   * overview above the detail; the detail replaces the overview, and the tab
   * bar above both comes from `projectApp` either way.
   *
   * ⚠️ The segment is `:analyticsDimension`, not `:dimension` or `:name`, and
   * that is load-bearing for the same reason `:appName` is. The router keeps
   * one key per position, so two routes naming different segments the same
   * thing collapse onto one and the inner param arrives missing. A name nobody
   * else will reach for is the whole protection.
   *
   * The segment is user input on its way to a query, so it is checked here
   * against the set of leaderboards that exist and 404s otherwise. Letting the
   * endpoint's own enum reject it would work too, and would answer 400 from a
   * fetch instead of rendering the app's own not-found page.
   */
  appAnalyticsDimension = $page({
    name: "appAnalyticsDimension",
    path: "/analytics/:analyticsDimension",
    schema: {
      params: z.object({
        analyticsDimension: z.string(),
      }),
    },
    head: (props, previous) => {
      const dimension = (props as { dimension?: string } | undefined)
        ?.dimension;
      return { title: `${previous?.title ?? ""} › ${dimension ?? "Detail"}` };
    },
    lazy: () => import("./components/project/apps/AppAnalyticsDimension.tsx"),
    loader: async ({ params }) => {
      this.assertBeacon();
      if (!ANALYTICS_DIMENSIONS.has(params.analyticsDimension)) {
        throw new NotFoundError("No such leaderboard");
      }
      return { dimension: params.analyticsDimension };
    },
    errorHandler: (error) => {
      if (HttpError.is(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
    },
  });

  appVitals = $page({
    name: "appVitals",
    path: "/vitals",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Vitals`,
    }),
    lazy: () => import("./components/project/apps/AppVitals.tsx"),
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
   * The gate the two analytics tabs share.
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
    schema: {
      /**
       * `?status=` seeds the quests table's status filter on arrival — the
       * drill-through target for a dashboard card, and for any link that
       * wants to open one slice of the backlog.
       *
       * ⚠️ **One-directional, and it has to stay that way.** The URL seeds
       * the filter on entry; the filter NEVER writes back. `?view=kanban`
       * was removed for exactly this (#156): an effect that restored a
       * missing param keyed on `useRouterState`, which is a global store, so
       * the outgoing render on the way *out* of the page saw the next
       * route's empty query and bounced the user straight back. Every
       * sidebar link was dead. A page cannot tell "nobody has chosen yet"
       * from "we are leaving" while the state lives in the URL — so nothing
       * here may reintroduce a write-back.
       *
       * ⚠️ Typed as free text, not the status enum. A schema that rejects
       * an unknown value turns a stale bookmark into an error page;
       * `ProjectQuestsTable` maps it through the known set and ignores
       * anything else, so a bad value degrades to the unfiltered list.
       */
      query: z.object({
        status: z.text().optional(),
      }),
    },
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Quests`,
    }),
    lazy: () => import("./components/project/ProjectQuestsPage.tsx"),
    loader: async () => {
      // The index of a project. `defaultSurface` decides which surface it
      // lands on, so a kanban-first team gets the board from every machine
      // and an invited member inherits it — which a per-browser cookie
      // (`questsViewAtom`, retired with this) could never do.
      //
      // ⚠️ This is NOT the shape that broke #156. That was a `useEffect`
      // seeding `?view=` from `localStorage` during render, which also ran
      // on the way OUT of the page, saw the next route's empty query and
      // bounced the user back — every sidebar link was dead. A loader
      // redirect runs once, on entry, resolves before anything paints, and
      // has no outgoing render to misread. Nothing here writes the URL back.
      const project = this.alepha.store.get(currentProjectAtom);
      if (project?.defaultSurface === "kanban" && project.features?.kanban) {
        throw new Redirection(`/${project.slug}/kanban`);
      }
    },
  });

  /**
   * The Kanban board as a destination rather than a mode.
   *
   * Sibling of `projectQuests` (which keeps `path: "/"`). Giving it a real
   * route is what lets it have a sidebar entry, a linkable URL and — once
   * the card route lands — addressable cards.
   */
  projectKanban = $page({
    name: "projectKanban",
    children: () => [this.projectKanbanCard],
    path: "/kanban",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Kanban`,
    }),
    // No loader: `ProjectKanbanPage` fetches the board itself, because the
    // board reloads in place when the header creates a quest and the loader
    // machinery does not re-run for that.
    lazy: () => import("./components/project/ProjectKanbanPage.tsx"),
  });

  /**
   * One card, open over the board.
   *
   * A child route rather than local state: clicking a card used to be
   * `setSelectedQuest(quest)`, which had no URL and — the part that
   * actually bit — **no refetch**, so a long-lived board edited whatever
   * `getBoard` returned however long ago. A loader gets fresh data on open
   * for free, and the card becomes linkable.
   *
   * ⚠️ The param is `shortId`, the SAME name `projectQuest` uses at the
   * same position. That is deliberate: the router keeps one param name per
   * path position, so two routes naming it DIFFERENTLY are what silently
   * lose the inner value (the trap `projectEpic`'s `epicNumber` documents).
   * Sharing the name is the safe side of that rule, as `projectSlug` does
   * across the whole tree.
   */
  projectKanbanCard = $page({
    name: "projectKanbanCard",
    path: "/:shortId",
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
    lazy: () => import("./components/project/ProjectKanbanCard.tsx"),
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
      // The board watches this atom to patch its own row, which is how an
      // edit in the sheet moves the card behind it without a refetch.
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

  projectEpics = $page({
    name: "projectEpics",
    path: "/epics",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Epics`,
    }),
    // No loader: `ProjectEpics` is an AlephaTable, which owns its own
    // fetch (filters, sort and page are its state, not the route's). A
    // loader here would fetch the list a second time and then have it
    // discarded on mount. Same arrangement as `projectBlights`.
    lazy: () => import("./components/project/epics/ProjectEpics.tsx"),
  });

  projectEpic = $page({
    name: "projectEpic",
    // `epicNumber`, NOT `number`: route params must be unique across the
    // whole route table, or two routes with different param names at the
    // same path position silently lose the inner value.
    path: "/epics/:epicNumber",
    schema: {
      params: z.object({
        epicNumber: z.integer(),
      }),
    },
    head: (props, previous) => {
      const epic = (props as { epic?: { title?: string } } | undefined)?.epic;
      return {
        title: `${previous?.title ?? ""} › ${epic?.title ?? "Epic"}`,
      };
    },
    lazy: () => import("./components/project/epics/ProjectEpic.tsx"),
    loader: async ({ params }) => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }
      const epic = await this.epicApi.getEpicByNumber({
        params: { projectId: project.id, number: params.epicNumber },
      });
      // The breadcrumb leaf lives in `ProjectView`, the layout above this
      // route, which can only see `epicNumber`. See `currentEpicAtom`.
      this.alepha.store.set(currentEpicAtom, epic);
      return { epic };
    },
    onLeave: () => {
      this.alepha.store.set(currentEpicAtom, undefined);
    },
    errorHandler: (error) => {
      if (HttpError.is(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
    },
  });

  projectReleases = $page({
    path: "/releases",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Releases`,
    }),
    lazy: () => import("./components/project/releases/ProjectReleases.tsx"),
  });

  projectRelease = $page({
    name: "projectRelease",
    // `releaseTag`, NOT `tag` and NOT `number`: route params must be unique
    // across the whole route table, or two routes with different param names
    // at the same path position silently lose the inner value. Same trap
    // `projectEpic`'s `epicNumber` documents.
    //
    // Addressed by the TAG rather than the number because
    // `/alepha/releases/0.28.0` is what the URL is for, and the tag is
    // already unique per project. `releaseTagSchema` makes it URL-safe by
    // construction; `number` stays the stable internal reference and the
    // sort key, it is simply not what addresses the page.
    path: "/releases/:releaseTag",
    schema: {
      params: z.object({
        releaseTag: z.string(),
      }),
    },
    head: (_props, previous) => ({
      // The tag is not in `props`: with no loader there is nothing to hand
      // the component, and `head` is fed the loader's result too. The page
      // reads the param from the router state instead.
      title: `${previous?.title ?? ""} › Release`,
    }),
    // No loader: the project route already holds every release with its
    // rollup in `currentReleasesAtom`, so the page resolves the tag from
    // there. A loader would fetch what is already in the store.
    lazy: () => import("./components/project/releases/ProjectRelease.tsx"),
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
      this.reportsQuality,
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

  /**
   * The one Reports tab whose data is INGESTED rather than derived.
   *
   * Deliberately not 404'd when `features.quality` is off, matching how the
   * `projectKanban` route stays reachable while only its sidebar entry is
   * gated: the flag decides whether the tab is offered, and a link someone
   * already holds should not break because a switch moved. What the flag does
   * gate is `reportsTabs`, so the tab is not advertised.
   */
  reportsQuality = $page({
    name: "reportsQuality",
    path: "/quality",
    lazy: () => import("./components/project/reports/ReportsQuality.tsx"),
    loader: async () => ({
      quality: await this.qualityApi.getQualityRuns({
        params: {
          projectId: this.alepha.store.get(currentProjectAtom)?.id ?? -1,
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
      this.projectSettingsArea,
      this.projectSettingsKanban,
      this.projectSettingsFolios,
      this.projectSettingsEpics,
      this.projectSettingsFeedback,
      this.projectSettingsSigils,
      this.projectSettingsReleases,
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
      // Neither read is caught. The invitations one used to be
      // `.catch(() => [])`, which is indistinguishable from "this project
      // has no pending invitations" — so an owner whose invitations failed
      // to load saw a members list that quietly claimed nobody had been
      // invited, and could re-send an invitation the server would then
      // refuse as a duplicate. A failed read is a broken page, and the
      // route's error state is what says so.
      //
      // Not the same call as `currentSigilsAtom`'s deliberate
      // `.catch(() => undefined)` in the project loader: that one costs a
      // sidebar SECTION on a page about something else, and it
      // distinguishes "empty" from "unreadable". Here the invitations ARE
      // the page.
      const [members, pendingInvitations] = await Promise.all([
        this.projectApi.getProjectMembers({
          params: { id: project.id },
        }),
        this.invitationApi.listProjectInvitations({
          params: { projectId: project.id },
        }),
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
      const areas = await this.areaApi.getAreas({
        params: { projectId: project.id },
      });
      return { areas };
    },
  });

  /**
   * The param is `areaId`, NOT the area's name: area names contain
   * slashes (`@alepha/ui`, `alepha/api/users`) and a path segment cannot
   * hold one. Route params must also be unique across the whole route
   * table — two routes with different param names at the same position
   * silently lose the inner value.
   */
  projectSettingsArea = $page({
    name: "projectSettingsArea",
    path: "/areas/:areaId",
    schema: {
      params: z.object({ areaId: z.integer() }),
    },
    head: (props, previous) => {
      const area = (props as { area?: { name?: string } } | undefined)?.area;
      return {
        title: `${previous?.title ?? ""} › ${area?.name ?? "Area"}`,
      };
    },
    lazy: () =>
      import("./components/project/settings/ProjectSettingsAreaPage.tsx"),
    loader: async ({ params }) => {
      const area = await this.areaApi.getArea({
        params: { id: params.areaId },
      });
      return { area };
    },
    // A deleted or foreign area is a 404, like the sibling detail routes,
    // not the generic error page.
    errorHandler: (error) => {
      if (HttpError.is(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
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

  projectSettingsEpics = $page({
    name: "projectSettingsEpics",
    path: "/epics",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Epics`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsEpicsPage.tsx"),
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

  projectSettingsReleases = $page({
    name: "projectSettingsReleases",
    path: "/releases",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Releases`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsReleasesPage.tsx"),
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
  // `dependsOn` component, laid out client-side, loaded once on mount.
  /**
   * One quest's questline: the `dependsOn` component it sits in, drawn with
   * the same `Questline` map the epic's Flow tab uses.
   *
   * ⚠️ **A quest inside an epic never renders here.** Its questline is the
   * epic's, and the epic's Flow tab already draws it beside that epic's own
   * chrome, so the loader redirects there rather than showing a second,
   * lonelier copy of the same map. The route survives for the quests that
   * belong to no epic, which are the ones with nowhere else to be drawn.
   *
   * The redirect is decided by `getQuestline`, in the same call that fetches
   * the component - the fork cannot be decided client-side, and answering it
   * in a second round trip would mean a page that renders and then navigates
   * away.
   *
   * The path keeps `/graph`. It is a link people already hold, and the page
   * behind it still answers the question that name asks.
   */
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
        title: `${previous?.title ?? ""} › ${quest?.title ?? "Quest"} › Questline`,
      };
    },
    lazy: () => import("./components/project/quest/QuestQuestline.tsx"),
    loader: async ({ params }) => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }
      const { epic, quests } = await this.questApi.getQuestline({
        params: {
          projectId: project.id,
          shortId: params.shortId,
        },
      });

      if (epic) {
        // `?tab=flow` is what `useDetailTab` reads on the epic page, so this
        // lands on the Flow tab rather than the epic's default one.
        throw new Redirection(`/${project.slug}/epics/${epic.number}?tab=flow`);
      }

      // The focus quest is in the component by construction - it is the
      // quest the walk started from - so the head needs no second fetch.
      const quest = quests.find((q) => q.shortId === params.shortId);
      return { quest, quests };
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
      // The tree's own two lists, which `seedFolioTree` owns — the folio
      // list AND the directory list, the latter load-bearing: the tree's
      // fallback
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
      await this.seedFolioTree(projectId);
      // `/folios` itself is just "Folios" in the header — a folio page
      // appends its own directory chain and title when it loads.
      this.alepha.store.set(currentFolioPathAtom, []);
    },
    onLeave: () => {
      this.alepha.store.set(currentFolioPathAtom, []);
      this.alepha.store.set(currentFolioBlobsAtom, []);
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
      // A draft has no attachments of its own: without this the last opened
      // folio's blobs were offered in the new folio's link picker.
      this.alepha.store.set(currentFolioBlobsAtom, []);
      // Carry the source directory across the navigation: the folio tree's
      // create link adds `?dir=<shortId>` when the user is in a directory; resolve to a UUID here so the editor can pass
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
          },
        }),
        this.seedFolioTree(project.id),
      ]);
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
