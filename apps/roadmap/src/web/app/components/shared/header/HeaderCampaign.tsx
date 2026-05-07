import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@alepha/ui/components/ui/toggle-group";
import { useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter, useRouterState } from "alepha/react/router";
import { Columns3, Plus, Square, SquareCheck, Table } from "lucide-react";
import type { AppRouter } from "../../../AppRouter.ts";
import { currentCampaignAtom } from "../../../atoms/currentCampaignAtom.ts";
import { kanbanCampaignAtom } from "../../../atoms/kanbanCampaignAtom.ts";
import { userCampaignsAtom } from "../../../atoms/userCampaignsAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

export type HeaderCampaignProps = {};

const HeaderCampaign = (_props: HeaderCampaignProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [campaign] = useStore(currentCampaignAtom);
  const [kanban] = useStore(kanbanCampaignAtom);
  const router = useRouter<AppRouter>();
  const routerState = useRouterState();
  const { params } = routerState;
  const [campaigns = []] = useStore(userCampaignsAtom);
  const auth = useAuth();

  const activeCampaign = campaign ?? kanban?.campaign;
  if (!activeCampaign) {
    return null;
  }

  const isKanban = routerState.name === "kanban";
  const campaignId = activeCampaign.id;

  const handleToggle = (value: string) => {
    if (!value) return;
    setTimeout(() => {
      if (value === "kanban") {
        router.push("kanban", { params: { campaignId: String(campaignId) } });
      } else {
        router.push("campaign", { params: { campaignId: String(campaignId) } });
      }
    });
  };

  return (
    <div className="hidden items-center gap-2 sm:flex">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="capitalize">
            {activeCampaign.title}
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

      {auth.user && campaigns.some((p) => p.id === campaignId) && (
        <ToggleGroup
          type="single"
          size="sm"
          value={isKanban ? "kanban" : "roadmap"}
          onValueChange={handleToggle}
        >
          <ToggleGroupItem value="roadmap" aria-label="Board">
            <Table className="size-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="kanban" aria-label="Kanban">
            <Columns3 className="size-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      )}
    </div>
  );
};

export default HeaderCampaign;
