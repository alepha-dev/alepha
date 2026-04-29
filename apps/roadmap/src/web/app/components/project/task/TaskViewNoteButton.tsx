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
import type { TaskController } from "@/api/controllers/TaskController.ts";
import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";
import { currentAssignedTasksAtom } from "@/web/app/atoms/currentAssignedTasksAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface TaskViewNoteButtonProps {
  task: TaskResource;
  onUpdate: (task: TaskResource) => void;
}

const TaskViewNoteButton = (props: TaskViewNoteButtonProps) => {
  const [showDialog, setShowDialog] = useState(false);
  const [noteText, setNoteText] = useState(props.task.note || "");
  const client = useClient<TaskController>();
  const alepha = useAlepha();
  const { tr } = useI18n<I18n, "en">();

  if (!client.updateTaskNote.can()) return null;

  const handleSave = async () => {
    const updatedTask = await client.updateTaskNote({
      params: { id: props.task.id },
      body: { note: noteText },
    });
    props.onUpdate(updatedTask);
    const currentTasks = alepha.store.get(currentAssignedTasksAtom) || [];
    const updatedTasks = currentTasks.map((t) =>
      t.id === updatedTask.id ? updatedTask : t,
    );
    alepha.store.set(currentAssignedTasksAtom, updatedTasks);
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
              setNoteText(props.task.note || "");
              setShowDialog(true);
            }}
          >
            <NotebookText className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tr("task.view.notes")}</TooltipContent>
      </Tooltip>

      <Sheet open={showDialog} onOpenChange={setShowDialog}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-2xl"
        >
          <SheetHeader>
            <SheetTitle>{tr("task.view.notes.title")}</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-3 p-4">
            <Textarea
              placeholder={String(tr("task.view.notes.placeholder"))}
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
                {tr("task.view.notes.save")}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};

export default TaskViewNoteButton;
