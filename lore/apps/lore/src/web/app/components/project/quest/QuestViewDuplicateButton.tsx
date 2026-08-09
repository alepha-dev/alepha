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
import { Copy } from "lucide-react";
import { useState } from "react";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import QuestCreate from "./QuestCreate.tsx";

export interface QuestViewDuplicateButtonProps {
  quest: QuestResource;
}

const QuestViewDuplicateButton = (props: QuestViewDuplicateButtonProps) => {
  const [showDialog, setShowDialog] = useState(false);
  const client = useClient<QuestController>();
  const [project] = useStore(currentProjectAtom);
  const { tr } = useI18n<I18n, "en">();

  if (!project) return null;
  if (!client.createQuest.can()) return null;

  const duplicateQuestData = {
    title: `${props.quest.title} ${tr("quest.view.duplicate.suffix")}`,
    description: props.quest.description,
    area: props.quest.area,
    priority: props.quest.priority,
    difficulty: props.quest.difficulty,
    objectives: props.quest.objectives.map((obj) => ({
      title: obj.title,
      completed: false,
    })),
  };

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
          <Copy className="size-4" />
        </TooltipTrigger>
        <TooltipContent>{tr("quest.view.duplicate")}</TooltipContent>
      </Tooltip>

      <Sheet open={showDialog} onOpenChange={setShowDialog}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto data-[side=right]:sm:max-w-[50vw]"
        >
          <SheetHeader>
            <SheetTitle>{tr("quest.view.duplicate.title")}</SheetTitle>
          </SheetHeader>
          <div className="p-4">
            <QuestCreate
              project={project}
              quest={duplicateQuestData as QuestResource}
              onSubmit={() => setShowDialog(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};

export default QuestViewDuplicateButton;
