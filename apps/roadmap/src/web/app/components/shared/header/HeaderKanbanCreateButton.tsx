import { Button } from "@alepha/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@alepha/ui/components/ui/sheet";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Plus } from "lucide-react";
import { useState } from "react";
import type { TaskController } from "../../../../../api/controllers/TaskController.ts";
import {
  kanbanProjectAtom,
  kanbanReloadAtom,
} from "../../../atoms/kanbanProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import TaskCreate from "../../project/task/TaskCreate.tsx";

export type HeaderKanbanCreateButtonProps = {};

const HeaderKanbanCreateButton = (_props: HeaderKanbanCreateButtonProps) => {
  const [showDialog, setShowDialog] = useState(false);
  const { tr } = useI18n<I18n, "en">();
  const client = useClient<TaskController>();
  const [kanban] = useStore(kanbanProjectAtom);
  const [reloadKey, setReloadKey] = useStore(kanbanReloadAtom);

  if (!kanban || kanban.readOnly) {
    return null;
  }

  return (
    <Sheet open={showDialog} onOpenChange={setShowDialog}>
      <SheetTrigger asChild>
        <Button
          size="sm"
          className="gap-2 bg-green-600 text-white hover:bg-green-700"
          disabled={!client.createTask.can()}
        >
          <Plus className="size-4" />
          <span className="hidden sm:inline">
            {tr("project.menu.create-task")}
          </span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{tr("project.menu.create-task")}</SheetTitle>
        </SheetHeader>
        <div className="p-4">
          <TaskCreate
            project={kanban.project}
            onSubmit={() => setShowDialog(false)}
            onCreated={() => {
              setShowDialog(false);
              setReloadKey({ key: (reloadKey?.key ?? 0) + 1 });
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default HeaderKanbanCreateButton;
