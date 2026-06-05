import {
  AppShell,
  type NavGroup,
} from "@alepha/ui/components/app-shell/app-shell";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  Link,
  NestedView,
  useRouter,
  useRouterState,
} from "alepha/react/router";
import {
  BarChart3,
  BookMarked,
  BookOpen,
  Bug,
  ChevronRight,
  Cog,
  Grid3x2,
  History,
  Inbox,
  KanbanSquare,
  Lock,
  ShoppingBag,
  Users,
} from "lucide-react";
import {
  type CampaignFeatures,
  defaultCampaignFeatures,
} from "@/api/entities/campaigns.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { currentArchivePathAtom } from "../../atoms/currentArchivePathAtom.ts";
import { currentBlightCountAtom } from "../../atoms/currentBlightCountAtom.ts";
import { currentCampaignAtom } from "../../atoms/currentCampaignAtom.ts";
import { currentPetitionCountAtom } from "../../atoms/currentPetitionCountAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import CharacterSidebarCard from "../character/CharacterSidebarCard.tsx";
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
  "campaignBlights",
  "campaignInsights",
  "campaignQuestGraph",
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
  campaignBlights: "campaign.menu.blights",
  campaignInsights: "campaign.menu.insights",
  campaignMyCharacter: "campaign.menu.myCharacter",
  campaignRoster: "campaign.menu.roster",
  campaignShop: "campaign.menu.shop",
  campaignSettings: "campaign.menu.settings",
  campaignSettingsBanner: "campaign.menu.settings",
  campaignSettingsZones: "campaign.menu.settings",
  campaignSettingsKanban: "campaign.menu.settings",
  campaignSettingsFolios: "campaign.menu.settings",
  campaignSettingsChapters: "campaign.menu.settings",
};

const CampaignView = () => {
  const routerState = useRouterState();
  const router = useRouter<AppRouter>();
  const { tr } = useI18n<I18n, "en">();
  const name = routerState.name ?? "";
  const showQuestLog = ROUTES_WITH_QUEST_LOG.has(name);
  const fullWidth = ROUTES_FULL_WIDTH.has(name);

  const [campaign] = useStore(currentCampaignAtom);
  const [petitionCount] = useStore(currentPetitionCountAtom);
  const [blightCount] = useStore(currentBlightCountAtom);
  const [archivePath] = useStore(currentArchivePathAtom);

  if (!campaign) {
    return null;
  }

  const campaignId = String(campaign.id);

  const features: CampaignFeatures = {
    ...defaultCampaignFeatures,
    ...campaign.features,
  };

  // Activity = the work surfaces (read/write the campaign's quests + inbox).
  const activityItems: NavGroup["items"] = [
    {
      label: tr("campaign.menu.board"),
      icon: Grid3x2,
      href: router.path("campaignBoard", { params: { campaignId } }),
      active: name === "campaignBoard" || name === "campaign",
    },
  ];
  if (features.kanban) {
    activityItems.push({
      label: tr("campaign.menu.kanban"),
      icon: KanbanSquare,
      href: router.path("campaignKanban", { params: { campaignId } }),
      active: name === "campaignKanban",
    });
  }
  // Audience = owner-facing surfaces fed by the campaign's audience and its
  // Sigils embeds — voluntary feedback (Petitions), crash telemetry
  // (Blights), pageview analytics (Insights). All feature-gated, so the
  // group only appears when at least one is enabled.
  const audienceItems: NavGroup["items"] = [];
  if (features.petitions) {
    audienceItems.push({
      label: tr("campaign.menu.petitions"),
      icon: Inbox,
      href: router.path("campaignPetitions", { params: { campaignId } }),
      active: name === "campaignPetitions",
      badge: petitionCount?.count ? petitionCount.count : undefined,
    });
  }
  if (features.blights) {
    audienceItems.push({
      label: tr("campaign.menu.blights"),
      icon: Bug,
      href: router.path("campaignBlights", { params: { campaignId } }),
      active: name === "campaignBlights",
      badge: blightCount?.count ? blightCount.count : undefined,
    });
  }
  if (features.beacon) {
    audienceItems.push({
      label: tr("campaign.menu.insights"),
      icon: BarChart3,
      href: router.path("campaignInsights", { params: { campaignId } }),
      active: name === "campaignInsights",
    });
  }

  // Knowledge = artifacts the campaign accumulates over time.
  const knowledgeItems: NavGroup["items"] = [];
  if (features.folios) {
    knowledgeItems.push({
      label: tr("campaign.menu.folios"),
      icon: BookOpen,
      href: router.path("campaignFolios", { params: { campaignId } }),
      active: name.startsWith("campaignFolios"),
    });
  }
  if (features.chapters) {
    knowledgeItems.push({
      label: tr("campaign.menu.chapters"),
      icon: BookMarked,
      href: router.path("campaignChapters", { params: { campaignId } }),
      active: name === "campaignChapters",
    });
  }
  // Chronicles is a Shop feature. When not bought, the entry stays
  // visible with its History icon on the left and the disabled
  // treatment (dashed border + light bg + trailing Lock + cursor-not-
  // allowed) drawn by the @alepha/ui app-shell when `disabled: true`.
  // The hover dropdown explains why and links to the Shop.
  const chroniclesUnlocked = (campaign.unlockedFeatures ?? []).includes(
    "chronicles",
  );
  const shopHref = router.path("campaignShop", { params: { campaignId } });
  knowledgeItems.push({
    label: tr("campaign.menu.chronicles"),
    icon: History,
    href: chroniclesUnlocked
      ? router.path("campaignChronicles", { params: { campaignId } })
      : shopHref,
    active:
      chroniclesUnlocked &&
      (name === "campaignChronicles" || name.startsWith("chronicles")),
    disabled: !chroniclesUnlocked,
    tooltip: chroniclesUnlocked ? undefined : (
      <LockedFeatureCard
        bodyKey="campaign.menu.chronicles.locked.body"
        shopHref={shopHref}
      />
    ),
  });

  // Bottom strip — no header. Personal/meta entries: people, gold, config.
  const personalItems: NavGroup["items"] = [];
  // Roster appears only when there's a party of 2+ characters. Solo
  // campaigns simply don't see the entry — no greyed-out item.
  if ((campaign.characterCount ?? 0) >= 2) {
    personalItems.push({
      label: tr("campaign.menu.roster"),
      icon: Users,
      href: router.path("campaignRoster", { params: { campaignId } }),
      active: name === "campaignRoster",
    });
  }
  // Character Sheet entry intentionally not pushed here — the
  // CharacterSidebarCard mounted in the AppShell `sidebarFooter` is
  // the entry point to /character.
  personalItems.push({
    label: tr("campaign.menu.shop"),
    icon: ShoppingBag,
    href: shopHref,
    active: name === "campaignShop",
  });
  personalItems.push({
    label: tr("campaign.menu.settings"),
    icon: Cog,
    href: router.path("campaignSettingsBanner", { params: { campaignId } }),
    active: name.startsWith("campaignSettings"),
  });

  const nav: NavGroup[] = [
    { label: tr("campaign.menu.group.inn"), items: activityItems },
    { label: tr("campaign.menu.group.audience"), items: audienceItems },
    { label: tr("campaign.menu.group.library"), items: knowledgeItems },
    { items: personalItems },
  ].filter((group) => group.items.length > 0);

  const breadcrumbs: { label: string; href?: string }[] = [
    {
      label: campaign.title,
      href: router.path("campaign", { params: { campaignId } }),
    },
  ];
  const sectionKey = SECTION_LABEL_KEYS[name];
  if (sectionKey) {
    // For archive routes, the "Archive" section label links back to
    // the archive root so the user can climb out of a deep folio with
    // one click.
    const sectionHref = name.startsWith("campaignFolios")
      ? router.path("campaignFolios", { params: { campaignId } })
      : undefined;
    breadcrumbs.push({
      label: tr(sectionKey as never),
      href: sectionHref,
    });
  }
  // Archive routes contribute their directory chain (and the folio
  // title leaf) via `currentArchivePathAtom` — written by
  // ArchiveBrowser on every refresh and by the folio loader on view.
  if (name.startsWith("campaignFolios") && archivePath.length > 0) {
    for (const segment of archivePath) {
      breadcrumbs.push({
        label: segment.name,
        href:
          segment.shortId !== undefined
            ? `${router.path("campaignFolios", { params: { campaignId } })}?dir=${segment.shortId}`
            : undefined,
      });
    }
  }

  return (
    <AppShell
      embedded
      fill
      variant="inset"
      brand={<CampaignSwitcher />}
      nav={nav}
      sidebarFooter={<CharacterSidebarCard />}
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
          className={`flex min-h-0 flex-1 flex-col ${showQuestLog || fullWidth ? "overflow-hidden" : "overflow-auto"}`}
        >
          {showQuestLog ? (
            <div className="flex min-h-0 flex-1">
              <div
                className="border-border hidden min-h-0 shrink-0 border-r lg:flex"
                style={{ width: "25%", minWidth: 240, maxWidth: 420 }}
              >
                <QuestLog />
              </div>
              {/* QuestView owns its own scroll (`overflow-y-auto` on its
                  body), so this wrapper must NOT also scroll — a nested
                  `overflow-auto` here showed a spurious scrollbar even on
                  short quests. Matches the `fullWidth` branch's no-scroll
                  intent. */}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
                <NestedView />
              </div>
            </div>
          ) : fullWidth ? (
            <div className="flex min-h-0 w-full flex-1 flex-col">
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

/**
 * Rich tooltip body for a paywalled nav entry. Rendered inside the
 * AppShell's HoverCard when a locked nav item is hovered. Title +
 * feature-specific body + Shop link.
 *
 * `bodyKey` is the i18n key for the feature-specific copy (e.g.
 * `campaign.menu.chronicles.locked.body`). Keeping it as a key
 * rather than a ReactNode keeps the i18n surface flat and easy to
 * translate.
 */
const LockedFeatureCard = (props: { bodyKey: string; shopHref: string }) => {
  const { tr } = useI18n<I18n, "en">();
  return (
    <div className="flex max-w-xs flex-col gap-2">
      <div className="text-foreground flex items-center gap-1.5 text-sm font-semibold">
        <Lock className="size-3.5" />
        {tr("campaign.menu.locked.title" as never)}
      </div>
      <p className="text-muted-foreground text-xs leading-relaxed">
        {tr(props.bodyKey as never)}
      </p>
      <Link
        href={props.shopHref}
        className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline"
      >
        <ShoppingBag className="size-3" />
        {tr("campaign.menu.locked.cta" as never)}
        <ChevronRight className="size-3" />
      </Link>
    </div>
  );
};
