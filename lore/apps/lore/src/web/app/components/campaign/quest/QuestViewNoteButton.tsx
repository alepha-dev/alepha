import { Button } from "@alepha/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui/components/ui/sheet";
import { Textarea } from "@alepha/ui/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useAlepha, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { NotebookText } from "lucide-react";
import { useState } from "react";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentAssignedQuestsAtom } from "@/web/app/atoms/currentAssignedQuestsAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface QuestViewNoteButtonProps {
  quest: QuestResource;
  onUpdate: (quest: QuestResource) => void;
}

const QuestViewNoteButton = (props: QuestViewNoteButtonProps) => {
  const [showDialog, setShowDialog] = useState(false);
  const [noteText, setNoteText] = useState(props.quest.note || "");
  const client = useClient<QuestController>();
  const alepha = useAlepha();
  const { tr } = useI18n<I18n, "en">();

  if (!client.updateQuestNote.can()) return null;

  const handleSave = async () => {
    const updatedQuest = await client.updateQuestNote({
      params: { id: props.quest.id },
      body: { note: noteText },
    });
    props.onUpdate(updatedQuest);
    const currentQuests = alepha.store.get(currentAssignedQuestsAtom) || [];
    const updatedQuests = currentQuests.map((t) =>
      t.id === updatedQuest.id ? updatedQuest : t,
    );
    alepha.store.set(currentAssignedQuestsAtom, updatedQuests);
    setShowDialog(false);
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => {
              setNoteText(props.quest.note || "");
              setShowDialog(true);
            }}
          >
            <NotebookText className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tr("quest.view.notes")}</TooltipContent>
      </Tooltip>

      <Sheet open={showDialog} onOpenChange={setShowDialog}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-2xl"
        >
          <SheetHeader>
            <SheetTitle>{tr("quest.view.notes.title")}</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-3 p-4">
            <Textarea
              placeholder={String(tr("quest.view.notes.placeholder"))}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              rows={10}
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowDialog(false)}
              >
                {tr("common.cancel")}
              </Button>
              <Button type="button" onClick={handleSave}>
                {tr("quest.view.notes.save")}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};

export default QuestViewNoteButton;
