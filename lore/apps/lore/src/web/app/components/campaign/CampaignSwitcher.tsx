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
import { Check, ChevronsUpDown, ImageIcon, Plus } from "lucide-react";
import type { AppRouter } from "../../AppRouter.ts";
import { currentCampaignAtom } from "../../atoms/currentCampaignAtom.ts";
import { userCampaignsAtom } from "../../atoms/userCampaignsAtom.ts";
import type { I18n } from "../../services/I18n.ts";

export type CampaignSwitcherProps = {};

const CampaignSwitcher = (_props: CampaignSwitcherProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const [campaign] = useStore(currentCampaignAtom);
  const [campaigns = []] = useStore(userCampaignsAtom);

  if (!campaign) {
    return null;
  }

  const sorted = [...campaigns].sort((a, b) =>
    a.updatedAt > b.updatedAt ? -1 : 1,
  );

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="border border-sidebar-border bg-background text-foreground hover:bg-background hover:text-foreground data-[state=open]:bg-background data-[state=open]:text-foreground"
            >
              <div className="bg-muted text-muted-foreground flex aspect-square size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg">
                {campaign.icon ? (
                  <img
                    src={`/api/files/${campaign.icon}`}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  <ImageIcon className="size-4" />
                )}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-semibold">{campaign.title}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="bottom"
            sideOffset={4}
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
          >
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
                  <span className="flex-1 truncate">{c.title}</span>
                  {isActive && <Check className="size-4" />}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={router.path("campaignCreate")}>
                <Plus className="size-4" />
                {tr("home.create-campaign")}
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
};

export default CampaignSwitcher;
