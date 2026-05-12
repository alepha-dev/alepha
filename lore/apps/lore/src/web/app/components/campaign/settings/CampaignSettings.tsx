import { cn } from "@alepha/ui/lib/utils";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  Link,
  NestedView,
  useRouter,
  useRouterState,
} from "alepha/react/router";
import {
  BookMarked,
  BookOpen,
  Inbox,
  KanbanSquare,
  type LucideIcon,
  MapPin,
  Settings as SettingsIcon,
  Users,
} from "lucide-react";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

type RouteName =
  | "campaignSettingsGeneral"
  | "campaignSettingsAdventurers"
  | "campaignSettingsZones"
  | "campaignSettingsKanban"
  | "campaignSettingsFolios"
  | "campaignSettingsPetitions"
  | "campaignSettingsChapters";

type NavLabelKey =
  | "campaign.settings.nav.general"
  | "campaign.settings.nav.adventurers"
  | "campaign.settings.nav.zones"
  | "campaign.settings.nav.kanban"
  | "campaign.settings.nav.folios"
  | "campaign.settings.nav.petitions"
  | "campaign.settings.nav.chapters";

interface NavItem {
  route: RouteName;
  labelKey: NavLabelKey;
  icon: LucideIcon;
}

interface NavGroup {
  labelKey?: "campaign.settings.nav.group.features";
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      {
        route: "campaignSettingsGeneral",
        labelKey: "campaign.settings.nav.general",
        icon: SettingsIcon,
      },
      {
        route: "campaignSettingsAdventurers",
        labelKey: "campaign.settings.nav.adventurers",
        icon: Users,
      },
      {
        route: "campaignSettingsZones",
        labelKey: "campaign.settings.nav.zones",
        icon: MapPin,
      },
    ],
  },
  {
    labelKey: "campaign.settings.nav.group.features",
    items: [
      {
        route: "campaignSettingsKanban",
        labelKey: "campaign.settings.nav.kanban",
        icon: KanbanSquare,
      },
      {
        route: "campaignSettingsFolios",
        labelKey: "campaign.settings.nav.folios",
        icon: BookOpen,
      },
      {
        route: "campaignSettingsPetitions",
        labelKey: "campaign.settings.nav.petitions",
        icon: Inbox,
      },
      {
        route: "campaignSettingsChapters",
        labelKey: "campaign.settings.nav.chapters",
        icon: BookMarked,
      },
    ],
  },
];

const CampaignSettings = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const routerState = useRouterState();
  const [campaign] = useStore(currentCampaignAtom);

  if (!campaign) {
    return null;
  }

  const campaignId = String(campaign.id);
  const activeRoute = routerState.name ?? "";

  return (
    <div className="mx-auto w-full max-w-6xl p-4 md:pt-10">
      <div className="flex flex-col gap-6 md:flex-row">
        <nav className="flex shrink-0 flex-col gap-4 md:w-48">
          {NAV_GROUPS.map((group, groupIdx) => (
            <div
              key={group.labelKey ?? `group-${groupIdx}`}
              className="flex flex-col gap-1"
            >
              {group.labelKey && (
                <span className="text-muted-foreground px-3 text-[11px] font-semibold uppercase tracking-wider">
                  {tr(group.labelKey)}
                </span>
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeRoute === item.route;
                const href = router.path(item.route, {
                  params: { campaignId },
                });
                return (
                  <Link
                    key={item.route}
                    href={href}
                    className={cn(
                      "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm transition-colors",
                      isActive
                        ? "bg-muted font-medium"
                        : "text-muted-foreground hover:bg-muted/60",
                    )}
                  >
                    <Icon className="size-4" />
                    {tr(item.labelKey)}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="flex-1">
          <NestedView />
        </div>
      </div>
    </div>
  );
};

export default CampaignSettings;
