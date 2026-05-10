import { Badge } from "@alepha/ui/components/ui/badge";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@alepha/ui/components/ui/toggle-group";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter, useRouterState } from "alepha/react/router";
import {
  BookOpen,
  ChartLine,
  Columns3,
  Home,
  Megaphone,
  ScrollText,
  Settings,
  Table,
} from "lucide-react";
import type { AppRouter } from "../../AppRouter.ts";
import { currentBeaconCountAtom } from "../../atoms/currentBeaconCountAtom.ts";
import { currentCampaignAtom } from "../../atoms/currentCampaignAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import CampaignActionsCreateButton from "./CampaignActionsCreateButton.tsx";

type TabValue =
  | "campaignDashboard"
  | "campaignBoard"
  | "campaignKanban"
  | "campaignChapters"
  | "campaignChronicles"
  | "campaignLore"
  | "campaignBeacons"
  | "campaignSettings";

const CampaignActions = () => {
  const [campaign] = useStore(currentCampaignAtom);
  const [beaconCount] = useStore(currentBeaconCountAtom);
  const router = useRouter<AppRouter>();
  const { tr } = useI18n<I18n, "en">();
  const routerState = useRouterState();

  if (!campaign) return null;

  const opts = {
    params: { campaignId: String(campaign.id) },
  };

  const name = routerState.name;

  const tabs: Array<{
    value: TabValue;
    icon: React.ReactNode;
    label: string;
    badge?: number;
  }> = [
    {
      value: "campaignDashboard",
      icon: <Home className="size-4" />,
      label: String(tr("campaign.menu.dashboard")),
    },
    {
      value: "campaignBoard",
      icon: <Table className="size-4" />,
      label: String(tr("campaign.menu.board")),
    },
    {
      value: "campaignKanban",
      icon: <Columns3 className="size-4" />,
      label: String(tr("campaign.menu.kanban")),
    },
    {
      value: "campaignChapters",
      icon: <BookOpen className="size-4" />,
      label: String(tr("campaign.menu.chapters")),
    },
    {
      value: "campaignChronicles",
      icon: <ChartLine className="size-4" />,
      label: String(tr("campaign.menu.chronicles")),
    },
    {
      value: "campaignLore",
      icon: <ScrollText className="size-4" />,
      label: String(tr("campaign.menu.lore")),
    },
    {
      value: "campaignBeacons",
      icon: <Megaphone className="size-4" />,
      label: String(tr("campaign.menu.beacons")),
      badge: beaconCount?.count ?? 0,
    },
    {
      value: "campaignSettings",
      icon: <Settings className="size-4" />,
      label: String(tr("campaign.menu.settings")),
    },
  ];

  return (
    <div className="bg-card border-border flex flex-1 items-center gap-2 rounded-md border p-1">
      <ToggleGroup
        type="single"
        value={name}
        onValueChange={(value) => {
          if (value) router.push(value as TabValue, opts);
        }}
        className="flex"
      >
        {tabs.map((tab) => (
          <ToggleGroupItem
            key={tab.value}
            value={tab.value}
            className="gap-1.5"
          >
            {tab.icon}
            <span className="hidden text-sm sm:inline">{tab.label}</span>
            {tab.badge && tab.badge > 0 ? (
              <Badge
                variant="destructive"
                className="ml-1 h-4 min-w-4 px-1 text-[10px]"
              >
                {tab.badge > 99 ? "99+" : tab.badge}
              </Badge>
            ) : null}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="flex-1" />
      <CampaignActionsCreateButton />
    </div>
  );
};

export default CampaignActions;
