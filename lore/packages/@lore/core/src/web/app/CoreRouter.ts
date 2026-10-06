import { $hook, $inject, Alepha, z } from "alepha";
import type { RealmController } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { $head, type Head } from "alepha/react/head";
import { $page, NotFound, ReactRouter, Redirection } from "alepha/react/router";
import { $secure, currentUserAtom } from "alepha/security";
import { HttpError, NotFoundError } from "alepha/server";
import { $client } from "alepha/server/links";
import { createElement } from "react";

import type { HomeController } from "../../api/controllers/HomeController.ts";
import type { InvitationController } from "../../api/controllers/InvitationController.ts";
import type { ProjectController } from "../../api/controllers/ProjectController.ts";
import type { ProjectDashboardController } from "../../api/controllers/ProjectDashboardController.ts";
import { $pageProject, $pageProjectSettings } from "./$pageProject.ts";
import { currentProjectAtom } from "./atoms/currentProjectAtom.ts";
import { homeBoardAtom } from "./atoms/homeBoardAtom.ts";
import { projectDashboardAtom } from "./atoms/projectDashboardAtom.ts";
import { realmSettingsAtom } from "./atoms/realmSettingsAtom.ts";
import { userProjectsAtom } from "./atoms/userProjectsAtom.ts";
import { isOAuthReturnTarget } from "./components/auth/oauthReturnTarget.ts";
import ErrorPage from "./components/shared/ErrorPage.tsx";
import { ProjectRouter } from "./ProjectRouter.ts";
import { ReportsTabRegistry } from "./registries/ReportsTabRegistry.ts";

/**
 * Core's pages (#E75, #Q2611): the root layout and the pages every Lore has
 * whatever its modules, sign-in, home, project creation, and the project's
 * dashboard, activity, reports shell, inbox and core settings. A module's
 * page mounts under one of these with `parent:` (`$pageProject`, or
 * `parent: core.layout`), so this router names no module page.
 */
export class CoreRouter {
  alepha = $inject(Alepha);
  projectApi = $client<ProjectController>();
  invitationApi = $client<InvitationController>();
  projectDashboardApi = $client<ProjectDashboardController>();
  router = $inject(ReactRouter);
  projectRouter = $inject(ProjectRouter);
  realmApi = $client<RealmController>();
  homeApi = $client<HomeController>();
  dateTime = $inject(DateTimeProvider);

  reportsTabs = $inject(ReportsTabRegistry);

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
      this.projectRouter.project,
      this.projectCreate,
      // A module's top-level page (the feedback request form, the public
      // roadmap) mounts here with `parent: core.layout`.
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
    /**
     * ⚠️ Declared for the bridge below, which read `query.redirect_uri` for
     * months without it and so never once fired: a loader's `query` holds
     * only what this schema declares (see the note on `register`). Every
     * sign-in on the way to a consent screen landed on the home page.
     * `test/oauth-login-bridge.spec.ts` renders the page through the router
     * so the decode in between is part of what it checks.
     */
    schema: {
      query: z.object({
        redirect_uri: z.text({ maxLength: 2048 }).optional(),
        redirect: z.text({ maxLength: 2048 }).optional(),
      }),
    },
    loader: async ({ query }) => {
      // OAuth bridge. The Alepha OAuth `authorize` endpoint and its device
      // approval page redirect unauthenticated users here with
      // `?redirect_uri=`, but `AuthLogin` reads `?redirect` and SPA-pushes to
      // it after sign-in — and an SPA push cannot reach a server-rendered
      // route. Translate the param and aim `?redirect` at the
      // `/oauth/continue` bridge page, which hard-navigates back once
      // authenticated.
      const redirectUri = query.redirect_uri;
      if (isOAuthReturnTarget(redirectUri) && !query.redirect) {
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
    /**
     * ⚠️ A loader's `query` holds ONLY what this schema declares, and is `{}`
     * otherwise. Nothing says so: an undeclared param reads as `undefined`,
     * the loader takes its no-token branch, and the page renders the ordinary
     * register form as if the link had carried nothing. It cost an hour here.
     * (`useRouter().query` inside the component is the raw URL query and is
     * unaffected, which is exactly what makes the difference invisible.)
     */
    schema: {
      query: z.object({
        invitation: z.text({ maxLength: 512 }).optional(),
      }),
    },
    /**
     * `?invitation=` carries the secret from the invite mail, and it is read
     * HERE rather than in the component because the answer decides what the
     * page is: a form for a stranger the realm would otherwise refuse, a
     * "sign in instead" for somebody who already has an account, or one of
     * four dead-end explanations. Resolving it after mount would render the
     * wrong one of those first.
     *
     * Behind a `catch`: an unreadable preview leaves `invitation` undefined
     * and the page falls back to the ordinary register form, which is the
     * behaviour that existed before the token did.
     */
    loader: async ({ query }) => {
      const token = query.invitation;
      const [realmConfig, invitation] = await Promise.all([
        this.realmApi.getRealmConfig(),
        token
          ? this.invitationApi
              .previewInvitationToken({ body: { token } })
              .catch(() => undefined)
          : undefined,
      ]);
      return { realmConfig, invitation, invitationToken: token };
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

  /**
   * How long the `home` loader waits for the board before painting without
   * it. Enough for the database half and a healthy Analytics Engine read, and
   * short enough that a slow one costs a pop-in rather than a slow page.
   */
  protected static readonly HOME_BOARD_BUDGET_MS = 300;

  /**
   * The board within its budget, or `undefined` past it or on a failure.
   */
  protected async readHomeBoard() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<undefined>((resolve) => {
      timer = setTimeout(
        () => resolve(undefined),
        CoreRouter.HOME_BOARD_BUDGET_MS,
      );
    });
    try {
      return await Promise.race([
        this.homeApi.getHomeBoard().catch(() => undefined),
        late,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

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
     * What the first paint needs: the realm's signup switch for an anonymous
     * visitor, the board for a signed-in one.
     *
     * The board (bars, last activity, open counts) used to be fetched by
     * `HomeBoard` after mount, so the rows painted alone and the rest popped
     * in a second later. It is read here now, within
     * `HOME_BOARD_BUDGET_MS`: the momentum half is an HTTP call into
     * Analytics Engine, and a slow one must not hold the page. Past the
     * budget, or on a failure, `homeBoardAtom` stays empty and `HomeBoard`
     * fetches it itself, as it always did.
     *
     * ⚠️ It runs on ENTRY only, and whatever is added here must keep that
     * shape: a loader that revalidates on its own dependencies is the
     * QuestGraph incident (folio #1057).
     */
    loader: async ({ user }) => {
      if (user) {
        this.alepha.store.set(homeBoardAtom, await this.readHomeBoard());
        return;
      }
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

  /**
   * The project's board, and the page you land on when you open a project.
   *
   * ⚠️ **It renders here; it does not redirect here**, and nothing may
   * redirect to it. This router has said so twice and both prohibitions were
   * paid for: a loader redirect on the project root is the shape #156 was
   * about, where a page could not tell "nobody has chosen yet" from "we are
   * leaving" and every sidebar link went dead, and a per-project "which page
   * do I open on" setting is the one feedback #2066 rejected. The board owns
   * `/` by BEING the page at `/`.
   *
   * ⚠️ **No capability gate and no permission gate**, unlike `projectQuests`
   * one route over, which 404s on both. Every project lands here whatever it
   * has turned on - a Knowledge-only one included, which lands on the empty
   * state - and a gate on the project root would lock people out of their own
   * project.
   *
   * The loader fills the card list so the grid lays out with the right tiles
   * before a single number exists; the page resolves them once on mount. It
   * catches to an empty board rather than failing the route: a board that
   * could not be read costs a board, and this is the page the project opens
   * on.
   */
  projectDashboard = $pageProject({
    path: "/",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Dashboard`,
    }),
    lazy: () => import("./components/project/dashboard/ProjectDashboard.tsx"),
    loader: async () => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }
      const listed = await this.projectDashboardApi
        .listProjectDashboardCards({ params: { projectId: project.id } })
        .catch(() => undefined);
      this.alepha.store.set(projectDashboardAtom, {
        projectId: project.id,
        cards: listed?.cards ?? [],
      });
    },
  });

  /**
   * What moved in this project: every recorded write, newest first.
   *
   * ⚠️ **Moved off `/` when the dashboard took the project root**, exactly as
   * Quests moved off it when Activity took it. It sits at `/activity`, a
   * SIBLING of every other project surface, and every caller reaches it by
   * NAME - so the path change touched no call site and a bare
   * `/:projectSlug` bookmark now lands on the board.
   *
   * What it used to argue here, and which is still true of Activity itself:
   * it is the one surface that says something whatever a project has turned
   * on, which is why it is Core and carries no capability gate. That is no
   * longer a reason for it to own the root, because the board is true of
   * every project too and answers a question rather than listing events.
   *
   * No loader. `ProjectActivityPage` fetches its own window and re-fetches
   * on demand, because the window is a control on the page rather than a
   * property of the URL.
   */
  projectActivity = $pageProject({
    path: "/activity",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Activity`,
    }),
    lazy: () => import("./components/project/activity/ProjectActivityPage.tsx"),
  });

  projectReports = $pageProject({
    path: "/reports",
    // Each tab is its module's page, mounted with `parent: core.projectReports`
    // and offered by `ReportsTabRegistry` (#E75, #Q2611).
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Reports`,
    }),
    lazy: () => import("./components/project/reports/ReportsLayout.tsx"),
    /**
     * Which registered tabs have something to show, for a tab whose gate needs
     * a request (Quality: whether any run exists).
     *
     * ⚠️ Read HERE and not on the `project` loader. That one already runs its
     * parallel reads on every project navigation, and most projects will never
     * push a run - so this is paid when Reports opens, by the one page that
     * needs the answer. A failed read hides a tab, never the page.
     */
    loader: async () => ({
      available: await this.reportsTabs.availability(
        this.alepha.store.get(currentProjectAtom)?.id ?? -1,
      ),
    }),
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Folios — project-scoped markdown notes ("folios")
  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Every message addressed to the viewer, from every project.
   *
   * ⚠️ **One route, not two.** A `/account/inbox` would be a second page for
   * the same list differing only in a default filter. The filter is a query
   * param instead, so both entry points reach the same page with the default
   * each of them wants: the sidebar lands on this project, and the header
   * bell's "See all" says `?scope=all`, because that dropdown is
   * cross-project and a footer showing fewer rows than the menu it came from
   * reads as messages going missing.
   *
   * No capability gate. The events that fill it span `work` and `support`,
   * so gating on either would leave a project generating messages with no
   * door to them - the same argument that puts the sidebar entry in
   * `CORE_NAV`.
   *
   * No loader: the page hands the controller to its own list, the way
   * `projectBlights` does, and the parent loader already seeded both counts.
   */
  projectInbox = $pageProject({
    name: "projectInbox",
    path: "/inbox",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Notifications`,
    }),
    // ⚠️ Declared, so the loader's `query` is not empty. A param the schema
    // does not name reads `undefined` in a loader while `useRouter().query`
    // three lines away in the component still has it, which is the trap the
    // invitation link cost an hour to.
    schema: {
      query: z.object({
        scope: z.string().optional(),
      }),
    },
    lazy: () => import("./components/project/inbox/ProjectInbox.tsx"),
  });

  projectSettingsBanner = $pageProjectSettings({
    name: "projectSettingsBanner",
    path: "/",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › General`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsGeneralPage.tsx"),
  });

  /**
   * General > Capabilities: every master switch, and the options that add a
   * sidebar entry (#Q2565). The only page that turns a capability back on,
   * since an off capability's own settings section leaves the sidebar.
   */
  projectSettingsCapabilities = $pageProjectSettings({
    name: "projectSettingsCapabilities",
    path: "/capabilities",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Capabilities`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsCapabilitiesPage.tsx"),
  });

  projectSettingsMembers = $pageProjectSettings({
    name: "projectSettingsMembers",
    path: "/members",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Members`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsMembersPage.tsx"),
  });

  /**
   * What each rank in this project may do (epic #E39).
   *
   * No loader: the page fetches four things that belong to it alone - the
   * permission catalogue, the ranks, the members holding them and the presets
   * - and none of them is read anywhere else, so putting them in the layout's
   * loader would make every other settings page pay for this one.
   *
   * ⚠️ Unguarded, like every other settings route. Who may EDIT ranks is
   * `rank:manage`, which hides the nav entry and which the module re-checks on
   * every write; a route guard would only turn a link somebody already holds
   * into a 404, and the page reads nothing a member may not read.
   */
  projectSettingsRanks = $pageProjectSettings({
    name: "projectSettingsRanks",
    path: "/ranks",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Ranks`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsRanksPage.tsx"),
  });

  /**
   * Quests > Agent prompts: the four templates. Renders nothing while the
   * `agentPrompts` option is off, and its tab is listed only while it is on.
   */
  projectSettingsPrompts = $pageProjectSettings({
    name: "projectSettingsPrompts",
    path: "/work/prompts",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Agent prompts`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsAgentPrompts.tsx"),
  });

  notFound = $page({
    path: "/*",
    component: NotFound,
  });
}
