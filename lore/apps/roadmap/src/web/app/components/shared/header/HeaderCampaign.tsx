import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter, useRouterState } from "alepha/react/router";
import { Plus, Square, SquareCheck } from "lucide-react";
import type { AppRouter } from "../../../AppRouter.ts";
import { currentCampaignAtom } from "../../../atoms/currentCampaignAtom.ts";
import { userCampaignsAtom } from "../../../atoms/userCampaignsAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

export type HeaderCampaignProps = {};

const HeaderCampaign = (_props: HeaderCampaignProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [campaign] = useStore(currentCampaignAtom);
  const router = useRouter<AppRouter>();
  const routerState = useRouterState();
  const { params } = routerState;
  const [campaigns = []] = useStore(userCampaignsAtom);

  if (!campaign) {
    return null;
  }

  return (
    <div className="hidden items-center gap-2 sm:flex">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="capitalize">
            {campaign.title}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {campaigns.map((p) => (
            <DropdownMenuItem
              key={p.id}
              onClick={() =>
                router.push("campaign", {
                  params: { campaignId: String(p.id) },
                })
              }
            >
              {params.campaignId === String(p.id) ? (
                <SquareCheck className="size-4" />
              ) : (
                <Square className="size-4" />
              )}
              {p.title}
            </DropdownMenuItem>
          ))}
          {!!campaigns.length && <DropdownMenuSeparator />}
          <DropdownMenuItem asChild>
            <Link href={router.path("campaignCreate")}>
              <Plus className="size-4" />
              {tr("home.create-campaign")}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export default HeaderCampaign;
