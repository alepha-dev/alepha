import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui/components/ui/sheet";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter, useRouterState } from "alepha/react/router";
import { BookOpen, ChevronDown, MessageSquarePlus, Plus } from "lucide-react";
import { useState } from "react";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { currentCampaignAtom } from "../../atoms/currentCampaignAtom.ts";
import { kanbanReloadAtom } from "../../atoms/kanbanCampaignAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import QuestCreate from "./quest/QuestCreate.tsx";

export type CampaignActionsCreateButtonProps = {};

const CampaignActionsCreateButton = (
  _props: CampaignActionsCreateButtonProps,
) => {
  const [showDialog, setShowDialog] = useState(false);
  const { tr } = useI18n<I18n, "en">();
  const client = useClient<QuestController>();
  const router = useRouter<AppRouter>();
  const [campaign] = useStore(currentCampaignAtom);
  const [reloadKey, setReloadKey] = useStore(kanbanReloadAtom);
  const routerState = useRouterState();
  const onKanban = routerState.name === "campaignKanban";

  if (!campaign) {
    return null;
  }

  const canCreateQuest = client.createQuest.can();
  const features = campaign.features;
  const folioEnabled = features.folios;
  const petitionEnabled = features.petitions;
  const hasSecondaryAction = folioEnabled || petitionEnabled;

  const mainLabel = String(tr("campaign.menu.create-quest"));

  // Green base for both halves; the caret half drops a touch of opacity so
  // the eye reads them as one button with a divider.
  const baseClass = "bg-green-600 text-white hover:bg-green-700";
  const mainClass = hasSecondaryAction
    ? `${baseClass} rounded-r-none`
    : baseClass;

  return (
    <>
      <div className="flex items-stretch">
        <Button
          size="icon"
          disabled={!canCreateQuest}
          onClick={() => setShowDialog(true)}
          aria-label={mainLabel}
          className={`${mainClass} md:w-auto md:px-4`}
        >
          <Plus className="size-4" />
          <span className="hidden md:inline">{mainLabel}</span>
        </Button>
        {hasSecondaryAction && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                disabled={!canCreateQuest}
                aria-label={String(tr("campaign.menu.create-more"))}
                className={`${baseClass} rounded-l-none border-l border-white/20 px-2`}
              >
                <ChevronDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              {folioEnabled && (
                <DropdownMenuItem
                  onClick={() =>
                    router.push("campaignFoliosNew", {
                      params: { campaignId: String(campaign.id) },
                    })
                  }
                >
                  <BookOpen className="size-4" />
                  {tr("campaign.menu.create-folio")}
                </DropdownMenuItem>
              )}
              {petitionEnabled && (
                <DropdownMenuItem
                  onClick={() =>
                    router.push("campaignPetitionRequest", {
                      params: { campaignId: String(campaign.id) },
                    })
                  }
                >
                  <MessageSquarePlus className="size-4" />
                  {tr("campaign.menu.create-petition")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <Sheet open={showDialog} onOpenChange={setShowDialog}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl"
        >
          <SheetHeader className="shrink-0">
            <SheetTitle>{mainLabel}</SheetTitle>
          </SheetHeader>
          <QuestCreate
            campaign={campaign}
            onSubmit={() => setShowDialog(false)}
            onCreated={
              onKanban
                ? () => {
                    setShowDialog(false);
                    setReloadKey({ key: (reloadKey?.key ?? 0) + 1 });
                  }
                : undefined
            }
          />
        </SheetContent>
      </Sheet>
    </>
  );
};

export default CampaignActionsCreateButton;
