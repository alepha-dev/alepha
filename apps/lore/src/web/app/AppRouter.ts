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
import type { CampaignController } from "../../api/controllers/CampaignController.ts";
import type { CampaignStatsController } from "../../api/controllers/CampaignStatsController.ts";
import type { ChapterController } from "../../api/controllers/ChapterController.ts";
import type { DirectoryController } from "../../api/controllers/DirectoryController.ts";
import type { FolioController } from "../../api/controllers/FolioController.ts";
import type { InvitationController } from "../../api/controllers/InvitationController.ts";
import type { KanbanController } from "../../api/controllers/KanbanController.ts";
import type { PetitionController } from "../../api/controllers/PetitionController.ts";
import type { QuestController } from "../../api/controllers/QuestController.ts";
import { campaignDirectoriesAtom } from "./atoms/campaignDirectoriesAtom.ts";
import { currentArchiveContentsAtom } from "./atoms/currentArchiveContentsAtom.ts";
import { currentArchivePathAtom } from "./atoms/currentArchivePathAtom.ts";
import { currentAssignedQuestsAtom } from "./atoms/currentAssignedQuestsAtom.ts";
import { currentBlightCountAtom } from "./atoms/currentBlightCountAtom.ts";
import { currentCampaignAtom } from "./atoms/currentCampaignAtom.ts";
import { currentCampaignMemberAtom } from "./atoms/currentCampaignMemberAtom.ts";
import { currentChaptersAtom } from "./atoms/currentChaptersAtom.ts";
import { currentFolioAtom } from "./atoms/currentFolioAtom.ts";
import { currentPetitionCountAtom } from "./atoms/currentPetitionCountAtom.ts";
import { currentQuestAtom } from "./atoms/currentQuestAtom.ts";
import { folioTagsAtom } from "./atoms/folioTagsAtom.ts";
import { userCampaignsAtom } from "./atoms/userCampaignsAtom.ts";
import { userFoliosAtom } from "./atoms/userFoliosAtom.ts";
import { MeRouter } from "./components/profile/me/MeRouter.ts";
import ErrorPage from "./components/shared/ErrorPage.tsx";

export class AppRouter {
  alepha = $inject(Alepha);
  questApi = $client<QuestController>();
  campaignApi = $client<CampaignController>();
  campaignStatsApi = $client<CampaignStatsController>();
  invitationAdminApi = $client<AdminInvitationController>();
  invitationApi = $client<InvitationController>();
  kanbanApi = $client<KanbanController>();
  petitionApi = $client<PetitionController>();
  blightApi = $client<BlightController>();
  chapterApi = $client<ChapterController>();
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
      this.campaign,
      this.campaignCreate,
      this.campaignPetitionRequest,
      this.meRouter.me,
      this.notFound,
    ],
    ssr: false,
    lazy: () => import("./components/Layout.tsx"),
    loader: async ({ user }) => {
      if (user) {
        this.alepha.store.set(
          userCampaignsAtom,
          await this.campaignApi.getHomeOverview(),
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
      if (state.url.pathname === "/new-campaign") {
        return {
          exit: { name: "fadeScaleOut", duration: 700, timing: "ease-in" },
        };
      }
    },
    lazy: () => import("./components/home/Home.tsx"),
  });

  campaignCreate = $page({
    path: "/new-campaign",
    head: { title: "New campaign › Alepha Lore" },
    animation: {
      enter: { name: "fadeIn", duration: 500, timing: "ease-out" },
    },
    lazy: () => import("./components/campaign/CampaignCreate.tsx"),
  });

  campaign = $page({
    children: () => [
      this.campaignBoard,
      this.campaignQuest,
      this.campaignQuestGraph,
      this.campaignChapters,
      this.campaignSettings,
      this.campaignChronicles,
      this.campaignFolios,
      this.campaignKanban,
      this.campaignPetitions,
      this.campaignBlights,
    ],
    path: "/c/:campaignId",
    schema: {
      params: z.object({
        campaignId: z.integer(),
      }),
    },
    head: (props) => {
      const campaign = (props as { campaign?: { title?: string } } | undefined)
        ?.campaign;
      return { title: campaign?.title ?? "Campaign" };
    },
    animation: ({ meta }) => {
      if (meta.firstOpen) {
        return {
          enter: {
            name: "campaignOpen",
            duration: 500,
            timing: "cubic-bezier(0.16, 1, 0.3, 1)",
          },
        };
      }
    },
    lazy: () => import("./components/campaign/CampaignView.tsx"),
    loader: async ({ params }) => {
      const { member, quests, ...campaign } =
        await this.campaignApi.getCampaignById({
          params: {
            id: params.campaignId,
          },
        });

      const chapters = await this.chapterApi.getChapters({
        params: { campaignId: params.campaignId },
      });

      // Pending-petition count for the sidebar badge. Fetched once per
      // campaign navigation instead of polled — accept/reject/remove
      // actions adjust the atom locally, so within-session math stays
      // correct. Errors leave the count undefined (badge hides).
      const pendingPetitions = await this.petitionApi
        .listPetitions({
          params: { campaignId: params.campaignId },
          query: { status: "pending" },
        })
        .then((r) => r.items.length)
        .catch(() => 0);

      // Open-blight count for the sidebar badge. Member-readable; `.catch`
      // keeps a transient error from blocking the whole campaign load
      // (badge just hides).
      const openBlights = campaign.features?.blights
        ? await this.blightApi
            .countOpenBlights({ params: { campaignId: params.campaignId } })
            .then((r) => r.count)
            .catch(() => 0)
        : 0;

      this.alepha.store.set(currentCampaignAtom, campaign);
      this.alepha.store.set(currentCampaignMemberAtom, member);
      this.alepha.store.set(currentAssignedQuestsAtom, quests);
      this.alepha.store.set(currentChaptersAtom, chapters);
      this.alepha.store.set(currentPetitionCountAtom, {
        count: pendingPetitions,
      });
      this.alepha.store.set(currentBlightCountAtom, { count: openBlights });

      return {
        campaign,
      };
    },
    onLeave: () => {
      this.alepha.store.set(currentCampaignMemberAtom, undefined);
      this.alepha.store.set(currentCampaignAtom, undefined);
      this.alepha.store.set(currentAssignedQuestsAtom, []);
      this.alepha.store.set(currentChaptersAtom, undefined);
      this.alepha.store.set(currentPetitionCountAtom, { count: 0 });
      this.alepha.store.set(currentBlightCountAtom, { count: 0 });
    },
  });

  campaignBlights = $page({
    name: "campaignBlights",
    path: "/blights",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Blights`,
    }),
    lazy: () => import("./components/campaign/blights/CampaignBlights.tsx"),
    loader: async () => {
      const campaign = this.alepha.store.get(currentCampaignAtom);
      if (!campaign) {
        throw new NotFoundError("Campaign not found");
      }
      // Gate purely on the module toggle — no paywall.
      if (!campaign.features?.blights) {
        throw new NotFoundError("Blights not enabled for this campaign");
      }
      const res = await this.blightApi.listBlights({
        params: { campaignId: campaign.id },
        query: {},
      });
      this.alepha.store.set(currentBlightCountAtom, {
        count: res.openCount,
      });
      return { items: res.items, openCount: res.openCount };
    },
  });

  campaignBoard = $page({
    path: "/",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Board`,
    }),
    lazy: () => import("./components/campaign/CampaignBoardTable.tsx"),
  });

  campaignChapters = $page({
    path: "/chapters",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Chapters`,
    }),
    lazy: () => import("./components/campaign/chapters/CampaignChapters.tsx"),
  });

  campaignKanban = $page({
    name: "campaignKanban",
    path: "/kanban",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Kanban`,
    }),
    lazy: () => import("./components/kanban/KanbanBoard.tsx"),
    loader: async () => {
      const campaign = this.alepha.store.get(currentCampaignAtom);
      if (!campaign) {
        throw new NotFoundError("Campaign not found");
      }
      const data = await this.kanbanApi.getBoard({
        params: { campaignId: campaign.id },
      });
      return data;
    },
  });

  campaignPetitions = $page({
    name: "campaignPetitions",
    path: "/petitions",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Petitions`,
    }),
    lazy: () => import("./components/campaign/petitions/CampaignPetitions.tsx"),
    loader: async () => {
      const campaign = this.alepha.store.get(currentCampaignAtom);
      if (!campaign) {
        throw new NotFoundError("Campaign not found");
      }
      const { items } = await this.petitionApi.listPetitions({
        params: { campaignId: campaign.id },
        query: { status: "pending" },
      });
      return { items };
    },
  });

  campaignChronicles = $page({
    path: "/chronicles",
    children: () => [
      this.chroniclesOverview,
      this.chroniclesQuests,
      this.chroniclesParty,
    ],
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Chronicles`,
    }),
    lazy: () => import("./components/campaign/chronicles/ChroniclesLayout.tsx"),
  });

  chroniclesOverview = $page({
    name: "chroniclesOverview",
    path: "/",
    lazy: () =>
      import("./components/campaign/chronicles/ChroniclesOverview.tsx"),
    loader: async () => ({
      overview: await this.campaignStatsApi.getChroniclesOverview({
        params: {
          id: this.alepha.store.get(currentCampaignAtom)?.id ?? -1,
        },
      }),
    }),
  });

  chroniclesQuests = $page({
    name: "chroniclesQuests",
    path: "/quests",
    lazy: () => import("./components/campaign/chronicles/ChroniclesQuests.tsx"),
    loader: async () => ({
      quests: await this.campaignStatsApi.getChroniclesQuests({
        params: {
          id: this.alepha.store.get(currentCampaignAtom)?.id ?? -1,
        },
      }),
    }),
  });

  chroniclesParty = $page({
    name: "chroniclesParty",
    path: "/party",
    lazy: () => import("./components/campaign/chronicles/ChroniclesParty.tsx"),
    loader: async () => ({
      party: await this.campaignStatsApi.getChroniclesParty({
        params: {
          id: this.alepha.store.get(currentCampaignAtom)?.id ?? -1,
        },
      }),
    }),
  });

  campaignSettings = $page({
    path: "/settings",
    children: () => [
      this.campaignSettingsBanner,
      this.campaignSettingsMembers,
      this.campaignSettingsZones,
      this.campaignSettingsKanban,
      this.campaignSettingsFolios,
      this.campaignSettingsSources,
      this.campaignSettingsChapters,
      this.campaignSettingsQuests,
    ],
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Settings`,
    }),
    lazy: () => import("./components/campaign/settings/CampaignSettings.tsx"),
  });

  campaignSettingsBanner = $page({
    name: "campaignSettingsBanner",
    path: "/",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › General`,
    }),
    lazy: () =>
      import("./components/campaign/settings/CampaignSettingsGeneralPage.tsx"),
  });

  campaignSettingsMembers = $page({
    name: "campaignSettingsMembers",
    path: "/members",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Members`,
    }),
    lazy: () =>
      import("./components/campaign/settings/CampaignSettingsMembersPage.tsx"),
    loader: async () => {
      const campaign = this.alepha.store.get(currentCampaignAtom);
      if (!campaign) {
        throw new NotFoundError("Campaign not found");
      }
      const [members, pendingInvitations] = await Promise.all([
        this.campaignApi.getCampaignMembers({
          params: { id: campaign.id },
        }),
        this.invitationApi
          .listCampaignInvitations({ params: { campaignId: campaign.id } })
          .catch(() => []),
      ]);
      return { members, pendingInvitations };
    },
  });

  campaignSettingsZones = $page({
    name: "campaignSettingsZones",
    path: "/zones",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Zones`,
    }),
    lazy: () =>
      import("./components/campaign/settings/CampaignSettingsZonesPage.tsx"),
    loader: async () => {
      const campaign = this.alepha.store.get(currentCampaignAtom);
      if (!campaign) {
        throw new NotFoundError("Campaign not found");
      }
      const zones = await this.campaignApi.getZones({
        params: { id: campaign.id },
      });
      return { zones };
    },
  });

  campaignSettingsKanban = $page({
    name: "campaignSettingsKanban",
    path: "/kanban",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Kanban`,
    }),
    lazy: () =>
      import("./components/campaign/settings/CampaignSettingsKanbanPage.tsx"),
  });

  campaignSettingsFolios = $page({
    name: "campaignSettingsFolios",
    path: "/folios",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Folios`,
    }),
    lazy: () =>
      import("./components/campaign/settings/CampaignSettingsFoliosPage.tsx"),
  });

  /**
   * Sources — which systems may file blights here.
   *
   * Lives alongside the sigils page while both credentials exist. Sigils go
   * once every reporter has moved over; the two are never merged, because a
   * sigil authenticated a website pushing raw telemetry and a source
   * authenticates an observer pushing aggregates.
   */
  campaignSettingsSources = $page({
    name: "campaignSettingsSources",
    path: "/sources",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Sources`,
    }),
    lazy: () =>
      import("./components/campaign/settings/CampaignSettingsSourcesPage.tsx"),
  });

  campaignSettingsChapters = $page({
    name: "campaignSettingsChapters",
    path: "/chapters",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Chapters`,
    }),
    lazy: () =>
      import("./components/campaign/settings/CampaignSettingsChaptersPage.tsx"),
  });

  campaignSettingsQuests = $page({
    name: "campaignSettingsQuests",
    path: "/quests",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Quests`,
    }),
    lazy: () =>
      import("./components/campaign/settings/CampaignSettingsQuestsPage.tsx"),
  });

  campaignQuest = $page({
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
    lazy: () => import("./components/campaign/quest/QuestView.tsx"),
    loader: async ({ params }) => {
      const campaign = this.alepha.store.get(currentCampaignAtom);
      if (!campaign) {
        throw new NotFoundError("Campaign not found");
      }
      const quest = await this.questApi.getQuestByShortId({
        params: {
          campaignId: campaign.id,
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
  campaignQuestGraph = $page({
    name: "campaignQuestGraph",
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
    lazy: () => import("./components/campaign/quest/QuestGraph.tsx"),
    loader: async ({ params }) => {
      const campaign = this.alepha.store.get(currentCampaignAtom);
      if (!campaign) {
        throw new NotFoundError("Campaign not found");
      }
      const quest = await this.questApi.getQuestByShortId({
        params: {
          campaignId: campaign.id,
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
  // Folios — campaign-scoped markdown notes ("folios")
  // -------------------------------------------------------------------------------------------------------------------

  // Quest #66 — Archive module. URL path renamed from /folios →
  // /archive (hard, no redirect — Lore is a small private app, no SEO
  // / link concerns). Internal route name stays `campaignFolios` so
  // components keep working without a cross-codebase rename;
  // DB tables, MCP tools, controllers also stay 'folios'-named per
  // folio #4 §3.
  campaignFolios = $page({
    name: "campaignFolios",
    children: () => [
      this.campaignFoliosNew,
      this.campaignFoliosFolio,
      this.campaignFoliosFolioEdit,
    ],
    path: "/archive",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Archive`,
    }),
    lazy: () => import("./components/folios/FoliosLayout.tsx"),
    loader: async ({ url }) => {
      const campaign = this.alepha.store.get(currentCampaignAtom);
      const campaignId = campaign?.id;
      if (campaignId === undefined) {
        throw new NotFoundError("Campaign not found");
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
              params: { campaignId, shortId },
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
          params: { campaignId },
          query: { parentId },
        }),
        this.folioApi.list({ query: { limit: 100, campaignId } }),
        this.folioApi.listTags({ query: { campaignId } }),
      ]);
      this.alepha.store.set(userFoliosAtom, folios);
      this.alepha.store.set(folioTagsAtom, tags);
      this.alepha.store.set(currentArchiveContentsAtom, contents);
      // Populate the archive breadcrumb (Lore › Archive › <dirs…>)
      // before the page renders. ArchiveBrowser keeps the atom in sync
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
      this.alepha.store.set(currentArchivePathAtom, segments);
    },
    onLeave: () => {
      this.alepha.store.set(currentFolioAtom, undefined);
      this.alepha.store.set(currentArchivePathAtom, []);
      this.alepha.store.set(currentArchiveContentsAtom, undefined);
    },
  });

  campaignFoliosNew = $page({
    name: "campaignFoliosNew",
    path: "/new",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › New`,
    }),
    lazy: () => import("./components/folios/FolioCreatePage.tsx"),
    loader: async ({ url }) => {
      this.alepha.store.set(currentFolioAtom, undefined);
      // Carry the source directory across the navigation: ArchiveBrowser's
      // "+ Create → New folio" link adds `?dir=<shortId>` when the user
      // is in a directory; resolve to a UUID here so the editor can pass
      // it to `folioApi.create({ directoryId })`. Without this, every
      // folio created via the Archive UI lands at the campaign root
      // regardless of the directory the user clicked from.
      const dirParam = url.searchParams.get("dir");
      const campaign = this.alepha.store.get(currentCampaignAtom);
      let directoryId: string | undefined;
      if (dirParam && campaign) {
        const shortId = Number.parseInt(dirParam, 10);
        if (Number.isFinite(shortId)) {
          try {
            const dir = await this.directoryApi.getDirectoryByShortId({
              params: { campaignId: campaign.id, shortId },
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

  campaignFoliosFolio = $page({
    name: "campaignFoliosFolio",
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
    lazy: () => import("./components/folios/FolioView.tsx"),
    loader: async ({ params }) => {
      const campaign = this.alepha.store.get(currentCampaignAtom);
      if (!campaign) {
        throw new NotFoundError("Campaign not found");
      }
      // Three calls in one tick → alepha auto-batches them into a
      // single `/api/_batch` round-trip. Folio (page subject), folio
      // list + directory list (FolioTreePanel sibling) all arrive in
      // one network hit, sparing the panel its own mount-time fetch.
      // See Lore #109.
      const [folio, folios, directories] = await Promise.all([
        this.folioApi.getByShortId({
          params: { campaignId: campaign.id, shortId: params.shortId },
          query: { withLinks: true, withPath: true },
        }),
        this.folioApi.list({ query: { campaignId: campaign.id, limit: 100 } }),
        this.directoryApi.listAllDirectories({
          params: { campaignId: campaign.id },
        }),
      ]);
      this.alepha.store.set(currentFolioAtom, folio);
      this.alepha.store.set(userFoliosAtom, folios);
      this.alepha.store.set(campaignDirectoriesAtom, directories);
      // Populate the archive breadcrumb so the AppShell header reads
      // "Lore › Archive › <dirs…> › <folio title>". Cleared on leave
      // by the parent `campaignFolios` route.
      const path = folio.metadata?.path ?? [];
      this.alepha.store.set(currentArchivePathAtom, [
        ...path,
        { name: folio.title },
      ]);
      return { folio };
    },
  });

  campaignFoliosFolioEdit = $page({
    name: "campaignFoliosFolioEdit",
    path: "/:shortId/edit",
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
        title: `${previous?.title ?? ""} › Edit ${dirPrefix}${folio?.title ?? "folio"}`,
      };
    },
    lazy: () => import("./components/folios/FolioEditPage.tsx"),
    loader: async ({ params }) => {
      const campaign = this.alepha.store.get(currentCampaignAtom);
      if (!campaign) {
        throw new NotFoundError("Campaign not found");
      }
      // Batched with the tree-panel data the editor doesn't render
      // today but might once #106/#107 land — cheap to pre-populate
      // here so the atom is hot. See Lore #109.
      const [folio, folios, directories] = await Promise.all([
        this.folioApi.getByShortId({
          params: { campaignId: campaign.id, shortId: params.shortId },
          query: { withPath: true },
        }),
        this.folioApi.list({ query: { campaignId: campaign.id, limit: 100 } }),
        this.directoryApi.listAllDirectories({
          params: { campaignId: campaign.id },
        }),
      ]);
      this.alepha.store.set(currentFolioAtom, folio);
      this.alepha.store.set(userFoliosAtom, folios);
      this.alepha.store.set(campaignDirectoriesAtom, directories);
      return { folio };
    },
  });

  campaignPetitionRequest = $page({
    name: "campaignPetitionRequest",
    path: "/c/:campaignId/request",
    schema: {
      params: z.object({ campaignId: z.integer() }),
    },
    head: { title: "Submit a petition › Alepha Lore" },
    ssr: false,
    lazy: () =>
      import("./components/campaign/petitions/CampaignPetitionRequest.tsx"),
  });

  notFound = $page({
    path: "/*",
    component: NotFound,
  });
}
