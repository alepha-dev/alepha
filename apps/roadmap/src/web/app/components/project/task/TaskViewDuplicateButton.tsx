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
import type { TaskController } from "@/api/controllers/TaskController.ts";
import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import TaskCreate from "./TaskCreate.tsx";

export interface TaskViewDuplicateButtonProps {
  task: TaskResource;
}

const TaskViewDuplicateButton = (props: TaskViewDuplicateButtonProps) => {
  const [showDialog, setShowDialog] = useState(false);
  const client = useClient<TaskController>();
  const [project] = useStore(currentProjectAtom);
  const { tr } = useI18n<I18n, "en">();

  if (!project) return null;
  if (!client.createTask.can()) return null;

  const duplicateTaskData = {
    title: `${props.task.title} ${tr("task.view.duplicate.suffix")}`,
    description: props.task.description,
    package: props.task.package,
    priority: props.task.priority,
    complexity: props.task.complexity,
    objectives: props.task.objectives.map((obj) => ({
      title: obj.title,
      completed: false,
    })),
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
            onClick={() => setShowDialog(true)}
          >
            <Copy className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tr("task.view.duplicate")}</TooltipContent>
      </Tooltip>

      <Sheet open={showDialog} onOpenChange={setShowDialog}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-2xl"
        >
          <SheetHeader>
            <SheetTitle>{tr("task.view.duplicate.title")}</SheetTitle>
          </SheetHeader>
          <div className="p-4">
            <TaskCreate
              project={project}
              task={duplicateTaskData as TaskResource}
              onSubmit={() => setShowDialog(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};

export default TaskViewDuplicateButton;
