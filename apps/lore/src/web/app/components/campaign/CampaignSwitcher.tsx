import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@alepha/ui/components/ui/sidebar";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Check, ChevronsUpDown, Home, Plus } from "lucide-react";
import type { AppRouter } from "../../AppRouter.ts";
import { currentCampaignAtom } from "../../atoms/currentCampaignAtom.ts";
import { userCampaignsAtom } from "../../atoms/userCampaignsAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import { CampaignIcon } from "../shared/CampaignIcon.tsx";

const CampaignSwitcher = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const [campaign] = useStore(currentCampaignAtom);
  const [overview] = useStore(userCampaignsAtom);

  if (!campaign) {
    return null;
  }

  const campaigns = overview?.campaigns ?? [];
  const canCreate = overview?.canCreate ?? true;
  const maxCampaigns = overview?.maxCampaigns;
  const sorted = [...campaigns].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  );

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="border border-sidebar-border bg-background text-foreground hover:bg-background hover:text-foreground data-[state=open]:bg-background data-[state=open]:text-foreground"
              />
            }
          >
            <CampaignIcon
              fileId={campaign.icon}
              className="size-8 rounded-lg"
            />
            <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate font-semibold">{campaign.title}</span>
            </div>
            <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="bottom"
            sideOffset={4}
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
          >
            <DropdownMenuItem render={<Link href={router.path("home")} />}>
              <Home className="size-4" />
              {tr("home.nav")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {sorted.map((c) => {
              const isActive = c.id === campaign.id;
              return (
                <DropdownMenuItem
                  key={c.id}
                  onClick={() => {
                    if (!isActive) {
                      router.push("campaign", {
                        params: { campaignId: String(c.id) },
                      });
                    }
                  }}
                >
                  <CampaignIcon fileId={c.icon} className="size-6" />
                  <span className="flex-1 truncate">{c.title}</span>
                  {isActive && <Check className="size-4" />}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            {canCreate ? (
              <DropdownMenuItem
                render={<Link href={router.path("campaignCreate")} />}
              >
                <Plus className="size-4" />
                {tr("home.create-campaign")}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled>
                <Plus className="size-4" />
                <div className="flex flex-col">
                  <span>{tr("home.create-campaign")}</span>
                  {maxCampaigns && (
                    <span className="text-muted-foreground text-xs">
                      {tr("home.create-campaign.max", {
                        args: [String(maxCampaigns)],
                      })}
                    </span>
                  )}
                </div>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
};

export default CampaignSwitcher;
