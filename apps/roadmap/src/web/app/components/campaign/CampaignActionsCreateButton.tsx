import { Button } from "@alepha/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui/components/ui/sheet";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Plus } from "lucide-react";
import { useState } from "react";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import { currentCampaignAtom } from "../../atoms/currentCampaignAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import QuestCreate from "./quest/QuestCreate.tsx";

export type CampaignActionsCreateButtonProps = {};

const CampaignActionsCreateButton = (
  props: CampaignActionsCreateButtonProps,
) => {
  const [showDialog, setShowDialog] = useState(false);
  const { tr } = useI18n<I18n, "en">();
  const client = useClient<QuestController>();
  const [campaign] = useStore(currentCampaignAtom);

  if (!campaign) {
    return null;
  }

  return (
    <div className="flex px-2">
      <Button
        size="sm"
        disabled={!client.createQuest.can()}
        onClick={() => setShowDialog(true)}
        className="bg-green-600 text-white hover:bg-green-700"
      >
        <Plus className="size-4" />
        <span className="hidden xl:inline">
          {tr("campaign.menu.create-quest")}
        </span>
      </Button>
      <Sheet open={showDialog} onOpenChange={setShowDialog}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 overflow-auto p-0 sm:max-w-2xl"
        >
          <SheetHeader>
            <SheetTitle>{tr("campaign.menu.create-quest")}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-auto p-4">
            <QuestCreate
              campaign={campaign}
              onSubmit={() => setShowDialog(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default CampaignActionsCreateButton;
