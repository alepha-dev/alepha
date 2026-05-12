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
import type { CampaignController } from "../../api/controllers/CampaignController.ts";
import type { CampaignStatsController } from "../../api/controllers/CampaignStatsController.ts";
import type { ChapterController } from "../../api/controllers/ChapterController.ts";
import type { FolioController } from "../../api/controllers/FolioController.ts";
import type { KanbanController } from "../../api/controllers/KanbanController.ts";
import type { PetitionController } from "../../api/controllers/PetitionController.ts";
import type { QuestController } from "../../api/controllers/QuestController.ts";
import { currentAssignedQuestsAtom } from "./atoms/currentAssignedQuestsAtom.ts";
import { currentCampaignAtom } from "./atoms/currentCampaignAtom.ts";
import { currentCampaignCharacterAtom } from "./atoms/currentCampaignCharacterAtom.ts";
import { currentChaptersAtom } from "./atoms/currentChaptersAtom.ts";
import { currentFolioAtom } from "./atoms/currentFolioAtom.ts";
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
  kanbanApi = $client<KanbanController>();
  petitionApi = $client<PetitionController>();
  chapterApi = $client<ChapterController>();
  folioApi = $client<FolioController>();
  router = $inject(ReactRouter);
  auth = $inject(ReactAuth);
  meRouter = $inject(MeRouter);
  realmApi = $client<RealmController>();

  head = $head(() => {
    const head: Head = {
      title: "Lore",
      titleSeparator: " - ",
      description: "Lore - Gamified campaign management",
    };

    head.link = [
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      { rel: "manifest", href: "/manifest.json" },
    ];

    head.meta = [
      { name: "theme-color", content: "#010409" },
      {
        name: "keywords",
        content: "Alepha, Lore, open-source, applications, platform",
      },
    ];

    return head;
  });

  layout = $page({
    children: () => [
      this.home,
      this.login,
      this.register,
      this.resetPassword,
      this.campaign,
      this.campaignCreate,
      this.kanbanRedirect,
      this.campaignPetitionRequest,
      this.campaignPetitionStatus,
      this.meRouter.me,
      this.notFound,
    ],
    ssr: false,
    lazy: () => import("./components/Layout.tsx"),
    loader: async ({ user }) => {
      if (user) {
        this.alepha.store.set(
          userCampaignsAtom,
          await this.campaignApi.getMyCampaigns(),
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

  resetPassword = $page({
    path: "/auth/reset-password",
    name: "resetPassword",
    head: { title: "Reset password" },
    lazy: () => import("./components/auth/AuthResetPasswordPage.tsx"),
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

  campaignCreate = $page({
    path: "/c-new",
    lazy: () => import("./components/campaign/CampaignCreate.tsx"),
  });

  /**
   * Legacy redirect — old shared `/k/:campaignId` links now go to the
   * integrated `campaignKanban` tab under the campaign layout.
   */
  kanbanRedirect = $page({
    name: "kanbanRedirect",
    path: "/k/:campaignId",
    loader: async ({ params }): Promise<unknown> => {
      throw new Redirection(`/c/${params.campaignId}/kanban`);
    },
  });

  campaign = $page({
    children: () => [
      this.campaignDashboard,
      this.campaignBoard,
      this.campaignQuest,
      this.campaignChapters,
      this.campaignSettings,
      this.campaignChronicles,
      this.campaignFolios,
      this.campaignKanban,
      this.campaignPetitions,
    ],
    path: "/c/:campaignId",
    schema: {
      params: t.object({
        campaignId: t.integer(),
      }),
    },
    lazy: () => import("./components/campaign/CampaignView.tsx"),
    loader: async ({ params }) => {
      const { character, quests, ...campaign } =
        await this.campaignApi.getCampaignById({
          params: {
            id: params.campaignId,
          },
        });

      const chapters = await this.chapterApi.getChapters({
        params: { campaignId: params.campaignId },
      });

      this.alepha.store.set(currentCampaignAtom, campaign);
      this.alepha.store.set(currentCampaignCharacterAtom, character);
      this.alepha.store.set(currentAssignedQuestsAtom, quests);
      this.alepha.store.set(currentChaptersAtom, chapters);

      return {
        campaign,
      };
    },
    onLeave: () => {
      this.alepha.store.set(currentCampaignCharacterAtom, undefined);
      this.alepha.store.set(currentCampaignAtom, undefined);
      this.alepha.store.set(currentAssignedQuestsAtom, []);
      this.alepha.store.set(currentChaptersAtom, undefined);
    },
  });

  campaignDashboard = $page({
    path: "/",
    lazy: () => import("./components/campaign/CampaignDashboard.tsx"),
  });

  campaignBoard = $page({
    path: "/board",
    lazy: () => import("./components/campaign/CampaignBoardTable.tsx"),
  });

  campaignChapters = $page({
    path: "/chapters",
    lazy: () => import("./components/campaign/chapters/CampaignChapters.tsx"),
  });

  campaignKanban = $page({
    name: "campaignKanban",
    path: "/kanban",
    head: { title: "Kanban" },
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
    head: { title: "Petitions" },
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
    lazy: () => import("./components/campaign/CampaignStats.tsx"),
    loader: async () => {
      const stats = await this.campaignStatsApi.getCampaignStats({
        params: {
          id: this.alepha.store.get(currentCampaignAtom)?.id ?? -1,
        },
      });
      return {
        stats,
      };
    },
  });

  campaignSettings = $page({
    path: "/settings",
    lazy: () => import("./components/campaign/settings/CampaignSettings.tsx"),
    loader: async () => {
      const campaign = this.alepha.store.get(currentCampaignAtom);
      if (!campaign) {
        throw new NotFoundError("Campaign not found");
      }

      const [adventurers, pendingInvitations] = await Promise.all([
        this.campaignApi.getCampaignAdventurers({
          params: { id: campaign.id },
        }),
        this.invitationAdminApi
          .findInvitations({
            query: {
              resourceType: "campaign",
              resourceId: String(campaign.id),
              status: "pending",
            },
          })
          .then((page) => page.content)
          .catch(() => []),
      ]);

      return {
        campaign,
        adventurers,
        pendingInvitations,
      };
    },
  });

  campaignQuest = $page({
    path: "/q/:questId",
    schema: {
      params: t.object({
        questId: t.integer(),
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
    lazy: () => import("./components/campaign/quest/QuestView.tsx"),
    loader: async ({ params }) => {
      const quest = await this.questApi.getQuestById({
        params: {
          id: params.questId,
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

  // -------------------------------------------------------------------------------------------------------------------
  // Folios — campaign-scoped markdown notes ("folios")
  // -------------------------------------------------------------------------------------------------------------------

  campaignFolios = $page({
    name: "campaignFolios",
    children: () => [
      this.campaignFoliosNew,
      this.campaignFoliosFolio,
      this.campaignFoliosFolioEdit,
    ],
    path: "/folios",
    head: { title: "Folios" },
    lazy: () => import("./components/folios/FoliosLayout.tsx"),
    loader: async () => {
      const campaign = this.alepha.store.get(currentCampaignAtom);
      const campaignId = campaign?.id;
      if (campaignId === undefined) {
        throw new NotFoundError("Campaign not found");
      }
      const [folios, tags] = await Promise.all([
        this.folioApi.list({ query: { limit: 100, campaignId } }),
        this.folioApi.listTags({ query: { campaignId } }),
      ]);
      this.alepha.store.set(userFoliosAtom, folios);
      this.alepha.store.set(folioTagsAtom, tags);
    },
    onLeave: () => {
      this.alepha.store.set(currentFolioAtom, undefined);
    },
  });

  campaignFoliosNew = $page({
    name: "campaignFoliosNew",
    path: "/new",
    head: { title: "New folio" },
    lazy: () => import("./components/folios/FolioCreatePage.tsx"),
    loader: async () => {
      this.alepha.store.set(currentFolioAtom, undefined);
      return {};
    },
  });

  campaignFoliosFolio = $page({
    name: "campaignFoliosFolio",
    path: "/:id",
    schema: {
      params: t.object({ id: t.uuid() }),
    },
    lazy: () => import("./components/folios/FolioView.tsx"),
    loader: async ({ params }) => {
      const folio = await this.folioApi.get({ params: { id: params.id } });
      this.alepha.store.set(currentFolioAtom, folio);
      return { folio };
    },
  });

  campaignFoliosFolioEdit = $page({
    name: "campaignFoliosFolioEdit",
    path: "/:id/edit",
    schema: {
      params: t.object({ id: t.uuid() }),
    },
    head: { title: "Edit folio" },
    lazy: () => import("./components/folios/FolioEditPage.tsx"),
    loader: async ({ params }) => {
      const folio = await this.folioApi.get({ params: { id: params.id } });
      this.alepha.store.set(currentFolioAtom, folio);
      return { folio };
    },
  });

  campaignPetitionRequest = $page({
    name: "campaignPetitionRequest",
    path: "/c/:campaignId/request",
    schema: {
      params: t.object({ campaignId: t.integer() }),
    },
    head: { title: "Submit a petition" },
    ssr: false,
    lazy: () =>
      import("./components/campaign/petitions/CampaignPetitionRequest.tsx"),
  });

  /**
   * Reporter-facing status page for a petition. Top-level (not nested under
   * `campaign`) so it works for users who aren't campaign members — the
   * `getMine` endpoint enforces that only the reporter or the campaign owner
   * can read.
   */
  campaignPetitionStatus = $page({
    name: "campaignPetitionStatus",
    path: "/c/:campaignId/p/:petitionId",
    schema: {
      params: t.object({
        campaignId: t.integer(),
        petitionId: t.integer(),
      }),
    },
    head: { title: "Petition status" },
    ssr: false,
    lazy: () =>
      import("./components/campaign/petitions/CampaignPetitionStatus.tsx"),
  });

  notFound = $page({
    path: "/*",
    component: NotFound,
  });
}
