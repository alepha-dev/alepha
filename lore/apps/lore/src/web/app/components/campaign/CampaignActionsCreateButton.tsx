import { Button } from "@alepha/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui/components/ui/sheet";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouterState } from "alepha/react/router";
import { Plus } from "lucide-react";
import { useState } from "react";
import type { QuestController } from "@/api/controllers/QuestController.ts";
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
  const [campaign] = useStore(currentCampaignAtom);
  const [reloadKey, setReloadKey] = useStore(kanbanReloadAtom);
  const routerState = useRouterState();
  const onKanban = routerState.name === "campaignKanban";

  if (!campaign) {
    return null;
  }

  return (
    <>
      <Button
        size="icon"
        disabled={!client.createQuest.can()}
        onClick={() => setShowDialog(true)}
        aria-label={String(tr("campaign.menu.create-quest"))}
        className="bg-green-600 text-white hover:bg-green-700 md:w-auto md:px-4"
      >
        <Plus className="size-4" />
        <span className="hidden md:inline">
          {tr("campaign.menu.create-quest")}
        </span>
      </Button>
      <Sheet open={showDialog} onOpenChange={setShowDialog}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl"
        >
          <SheetHeader className="shrink-0">
            <SheetTitle>{tr("campaign.menu.create-quest")}</SheetTitle>
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
