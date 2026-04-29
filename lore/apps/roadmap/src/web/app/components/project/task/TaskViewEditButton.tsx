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
import type { TaskController } from "@/api/controllers/TaskController.ts";
import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import TaskCreate from "./TaskCreate.tsx";

export interface TaskViewEditButtonProps {
  task: TaskResource;
  onUpdate: (task: TaskResource) => void;
  showDialog?: boolean;
  setShowDialog?: (show: boolean) => void;
}

const TaskViewEditButton = (props: TaskViewEditButtonProps) => {
  const showDialog = props.showDialog ?? false;
  const setShowDialog = props.setShowDialog ?? (() => {});

  const client = useClient<TaskController>();
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);

  if (!project) return null;
  if (!client.updateTaskById.can()) return null;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setShowDialog(true)}
          >
            <Pencil className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tr("task.view.edit")}</TooltipContent>
      </Tooltip>

      <Sheet open={showDialog} onOpenChange={setShowDialog}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-2xl"
        >
          <SheetHeader>
            <SheetTitle>{tr("task.create.update")}</SheetTitle>
          </SheetHeader>
          <div className="p-4">
            <TaskCreate
              project={project}
              task={props.task}
              onSubmit={(task) => {
                setShowDialog(false);
                props.onUpdate(task);
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};

export default TaskViewEditButton;
