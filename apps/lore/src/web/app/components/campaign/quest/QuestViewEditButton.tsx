import { Button } from "@alepha/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Pencil } from "lucide-react";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import QuestCreate from "./QuestCreate.tsx";

export interface QuestViewEditButtonProps {
  quest: QuestResource;
  onUpdate: (quest: QuestResource) => void;
  showDialog?: boolean;
  setShowDialog?: (show: boolean) => void;
}

const QuestViewEditButton = (props: QuestViewEditButtonProps) => {
  const showDialog = props.showDialog ?? false;
  const setShowDialog = props.setShowDialog ?? (() => {});

  const client = useClient<QuestController>();
  const { tr } = useI18n<I18n, "en">();
  const [campaign] = useStore(currentCampaignAtom);

  if (!campaign) return null;
  if (!client.updateQuestById.can()) return null;

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setShowDialog(true)}
            />
          }
        >
          <Pencil className="size-4" />
        </TooltipTrigger>
        <TooltipContent>{tr("quest.view.edit")}</TooltipContent>
      </Tooltip>

      <Sheet open={showDialog} onOpenChange={setShowDialog}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl"
        >
          <SheetHeader className="shrink-0">
            <SheetTitle>{tr("quest.create.update")}</SheetTitle>
          </SheetHeader>
          <QuestCreate
            campaign={campaign}
            quest={props.quest}
            onSubmit={(quest) => {
              setShowDialog(false);
              props.onUpdate(quest);
            }}
          />
        </SheetContent>
      </Sheet>
    </>
  );
};

export default QuestViewEditButton;
