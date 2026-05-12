import {
  AppShell,
  type NavGroup,
} from "@alepha/ui/components/app-shell/app-shell";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { NestedView, useRouter, useRouterState } from "alepha/react/router";
import {
  BookMarked,
  BookOpen,
  Cog,
  Grid3x2,
  History,
  Inbox,
  KanbanSquare,
} from "lucide-react";
import { useEffect } from "react";
import type { PetitionController } from "@/api/controllers/PetitionController.ts";
import {
  type CampaignFeatures,
  defaultCampaignFeatures,
} from "@/api/entities/campaigns.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { currentCampaignAtom } from "../../atoms/currentCampaignAtom.ts";
import { currentPetitionCountAtom } from "../../atoms/currentPetitionCountAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import ExperienceBar from "../misc/ExperienceBar.tsx";
import HeaderActions from "../shared/header/HeaderActions.tsx";
import CampaignActionsCreateButton from "./CampaignActionsCreateButton.tsx";
import CampaignSwitcher from "./CampaignSwitcher.tsx";
import QuestLog from "./QuestLog.tsx";

const ROUTES_WITH_QUEST_LOG = new Set(["campaignBoard", "campaignQuest"]);

const ROUTES_FULL_WIDTH = new Set([
  "campaignKanban",
  "campaignFolios",
  "campaignFoliosNew",
  "campaignFoliosFolio",
  "campaignFoliosFolioEdit",
  "campaignPetitions",
]);

const SECTION_LABEL_KEYS: Record<string, string> = {
  campaignBoard: "campaign.menu.board",
  campaignKanban: "campaign.menu.kanban",
  campaignChapters: "campaign.menu.chapters",
  campaignChronicles: "campaign.menu.chronicles",
  campaignFolios: "campaign.menu.folios",
  campaignFoliosNew: "campaign.menu.folios",
  campaignFoliosFolio: "campaign.menu.folios",
  campaignFoliosFolioEdit: "campaign.menu.folios",
  campaignPetitions: "campaign.menu.petitions",
  campaignSettings: "campaign.menu.settings",
  campaignSettingsGeneral: "campaign.menu.settings",
  campaignSettingsZones: "campaign.menu.settings",
  campaignSettingsKanban: "campaign.menu.settings",
  campaignSettingsFolios: "campaign.menu.settings",
  campaignSettingsPetitions: "campaign.menu.settings",
  campaignSettingsChapters: "campaign.menu.settings",
};

const PETITION_POLL_INTERVAL_MS = 30_000;

const CampaignView = () => {
  const routerState = useRouterState();
  const router = useRouter<AppRouter>();
  const { tr } = useI18n<I18n, "en">();
  const name = routerState.name ?? "";
  const showQuestLog = ROUTES_WITH_QUEST_LOG.has(name);
  const fullWidth = ROUTES_FULL_WIDTH.has(name);

  const [campaign] = useStore(currentCampaignAtom);
  const [petitionCount, setPetitionCount] = useStore(currentPetitionCountAtom);
  const setCount = (n: number) => setPetitionCount({ count: n });
  const petitionApi = useClient<PetitionController>();

  /**
   * Piggyback poll on `petitionApi.list` for the inbox badge. Skips when the
   * tab is hidden (mirrors the DevTools polling pattern) and silently
   * ignores errors — polling failures simply leave the count at 0.
   */
  useEffect(() => {
    if (!campaign) {
      setCount(0);
      return;
    }

    const campaignId = campaign.id;
    let cancelled = false;

    const refresh = async () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      try {
        const { items } = await petitionApi.listPetitions({
          params: { campaignId },
          query: { status: "pending" },
        });
        if (!cancelled) {
          setCount(items.length);
        }
      } catch {
        // silently ignore — petitions polling may have failed on this campaign
      }
    };

    refresh();
    const handle = window.setInterval(refresh, PETITION_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(handle);
      setCount(0);
    };
  }, [campaign?.id]);

  if (!campaign) {
    return null;
  }

  const campaignId = String(campaign.id);

  const features: CampaignFeatures = {
    ...defaultCampaignFeatures,
    ...campaign.features,
  };

  const innItems: NavGroup["items"] = [
    {
      label: tr("campaign.menu.board"),
      icon: Grid3x2,
      href: router.path("campaignBoard", { params: { campaignId } }),
      active: name === "campaignBoard" || name === "campaign",
    },
  ];
  if (features.kanban) {
    innItems.push({
      label: tr("campaign.menu.kanban"),
      icon: KanbanSquare,
      href: router.path("campaignKanban", { params: { campaignId } }),
      active: name === "campaignKanban",
    });
  }
  if (features.petitions) {
    innItems.push({
      label: tr("campaign.menu.petitions"),
      icon: Inbox,
      href: router.path("campaignPetitions", { params: { campaignId } }),
      active: name === "campaignPetitions",
      badge: petitionCount?.count ? petitionCount.count : undefined,
    });
  }

  const libraryItems: NavGroup["items"] = [];
  if (features.chapters) {
    libraryItems.push({
      label: tr("campaign.menu.chapters"),
      icon: BookMarked,
      href: router.path("campaignChapters", { params: { campaignId } }),
      active: name === "campaignChapters",
    });
  }
  if (features.folios) {
    libraryItems.push({
      label: tr("campaign.menu.folios"),
      icon: BookOpen,
      href: router.path("campaignFolios", { params: { campaignId } }),
      active: name.startsWith("campaignFolios"),
    });
  }
  libraryItems.push({
    label: tr("campaign.menu.chronicles"),
    icon: History,
    href: router.path("campaignChronicles", { params: { campaignId } }),
    active: name === "campaignChronicles",
  });

  const nav: NavGroup[] = [
    { label: tr("campaign.menu.group.inn"), items: innItems },
    { label: tr("campaign.menu.group.library"), items: libraryItems },
    {
      label: tr("campaign.menu.group.castle"),
      items: [
        {
          label: tr("campaign.menu.settings"),
          icon: Cog,
          href: router.path("campaignSettingsGeneral", {
            params: { campaignId },
          }),
          active: name.startsWith("campaignSettings"),
        },
      ],
    },
  ].filter((group) => group.items.length > 0);

  const breadcrumbs: { label: string; href?: string }[] = [
    {
      label: campaign.title,
      href: router.path("campaign", { params: { campaignId } }),
    },
  ];
  const sectionKey = SECTION_LABEL_KEYS[name];
  if (sectionKey) {
    breadcrumbs.push({ label: String(tr(sectionKey as never)) });
  }

  return (
    <AppShell
      embedded
      fill
      variant="inset"
      brand={<CampaignSwitcher />}
      nav={nav}
      breadcrumbs={breadcrumbs}
      topbarActions={
        <>
          <CampaignActionsCreateButton />
          <HeaderActions />
        </>
      }
    >
      <div className="flex h-full flex-col">
        <div
          className={`flex min-h-0 flex-1 flex-col ${showQuestLog ? "overflow-hidden" : "overflow-auto"}`}
        >
          {showQuestLog ? (
            <div className="flex min-h-0 flex-1 gap-2 p-2">
              <div
                className="hidden min-h-0 shrink-0 lg:flex"
                style={{ width: "25%", minWidth: 240, maxWidth: 420 }}
              >
                <QuestLog />
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-auto">
                <NestedView />
              </div>
            </div>
          ) : fullWidth ? (
            <div className="flex w-full flex-1 flex-col">
              <NestedView />
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col p-2">
              <NestedView />
            </div>
          )}
        </div>
        <div className="shrink-0 border-t bg-background">
          <ExperienceBar />
        </div>
      </div>
    </AppShell>
  );
};

export default CampaignView;
