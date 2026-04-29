import { Button } from "@alepha/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useAlepha, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useActive, useRouter } from "alepha/react/router";
import {
  Clock,
  NotebookText,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { TaskController } from "@/api/controllers/TaskController.ts";
import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentAssignedTasksAtom } from "@/web/app/atoms/currentAssignedTasksAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import TaskComplexity from "./TaskComplexity.tsx";

export interface TaskItemProps {
  task: TaskResource;
  index: number;
}

const stripHtml = (html: string) => {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, "").trim();
};

const TaskItem = (props: TaskItemProps) => {
  const { task } = props;

  const alepha = useAlepha();
  const { tr } = useI18n<I18n, "en">();
  const client = useClient<TaskController>();
  const router = useRouter<AppRouter>();
  const { isActive, anchorProps } = useActive(
    router.path("projectTask", { params: { taskId: task.id } }),
  );

  const clearNote = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const updatedTask = await client.updateTaskNote({
      params: { id: task.id },
      body: { note: "" },
    });
    const currentTasks = alepha.store.get(currentAssignedTasksAtom) || [];
    const updatedTasks = currentTasks.map((t) =>
      t.id === updatedTask.id ? updatedTask : t,
    );
    alepha.store.set(currentAssignedTasksAtom, updatedTasks);
  };

  const isTimerRunning = () => {
    if (!task.timerSessions || task.timerSessions.length === 0) return false;
    const lastSession = task.timerSessions[task.timerSessions.length - 1];
    return lastSession && !lastSession.stoppedAt;
  };

  const targetHref = isActive ? router.path("project") : anchorProps.href;

  return (
    <Link
      href={targetHref}
      className={[
        "border-border flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors",
        isActive
          ? "bg-primary text-primary-foreground"
          : "bg-card hover:bg-accent",
      ].join(" ")}
    >
      <div className="flex flex-1 items-center gap-2">
        <TaskComplexity complexity={task.complexity} />
        <span className="text-sm">{task.title}</span>
        {task.metadata.objectivesProgress.total > 1 && (
          <span className="text-[10px] opacity-70">
            {task.metadata.objectivesProgress.completed}/
            {task.metadata.objectivesProgress.total}
          </span>
        )}
      </div>

      <div className="flex items-center justify-center gap-1">
        {isTimerRunning() && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Clock
                className="size-4 fill-blue-500/20 text-blue-500"
                strokeWidth={2}
              />
            </TooltipTrigger>
            <TooltipContent className="flex flex-col gap-0.5">
              <span className="font-bold">{tr("task.view.timer.running")}</span>
              <span className="text-xs">
                {tr("task.view.timer.description")}
              </span>
            </TooltipContent>
          </Tooltip>
        )}

        {task.note?.trim() && (
          <Tooltip>
            <TooltipTrigger asChild>
              <NotebookText className="size-4 text-amber-500" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs whitespace-pre-wrap bg-amber-500 text-black">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">{stripHtml(task.note)}</span>
                {client.updateTaskNote.can() && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0 text-black hover:bg-black/10"
                    onClick={clearNote}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        )}

        {task.priority === "optional" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Sparkles className="text-muted-foreground size-4" />
            </TooltipTrigger>
            <TooltipContent className="flex flex-col gap-0.5">
              <span className="font-bold">{tr("task.item.bonus")}</span>
              <span className="text-xs">
                {tr("task.item.bonus.description")}
              </span>
            </TooltipContent>
          </Tooltip>
        ) : task.priority === "high" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <TriangleAlert className="size-4 text-red-500" />
            </TooltipTrigger>
            <TooltipContent className="flex flex-col gap-0.5">
              <span className="font-bold">{tr("task.item.highPriority")}</span>
              <span className="text-xs">
                {tr("task.item.highPriority.description")}
              </span>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </Link>
  );
};

export default TaskItem;
