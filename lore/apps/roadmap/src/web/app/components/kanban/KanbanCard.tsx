import { Badge } from "@alepha/ui/components/ui/badge";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, Sparkles } from "lucide-react";
import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";
import TaskComplexity from "../project/task/TaskComplexity.tsx";

export interface KanbanCardProps {
  task: TaskResource;
  readOnly: boolean;
  onSelect: (task: TaskResource) => void;
}

const priorityVariant = (
  priority: string,
): "default" | "secondary" | "destructive" | "outline" => {
  switch (priority) {
    case "high":
      return "destructive";
    case "medium":
      return "default";
    case "low":
      return "secondary";
    default:
      return "outline";
  }
};

const KanbanCard = (props: KanbanCardProps) => {
  const { task, readOnly, onSelect } = props;
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `task-${task.id}`,
      data: { type: "task", task },
      disabled: readOnly,
    });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : undefined,
  };

  const cursorClass = readOnly
    ? "cursor-pointer"
    : isDragging
      ? "cursor-grabbing"
      : "cursor-grab";

  return (
    <div ref={setNodeRef} style={style} className="p-1">
      <button
        type="button"
        onClick={() => onSelect(task)}
        {...(readOnly ? {} : { ...attributes, ...listeners })}
        className={`group flex w-full items-center gap-2 overflow-hidden rounded-md border border-border bg-card px-2 py-1.5 text-left shadow-sm transition-colors hover:bg-muted ${cursorClass}`}
      >
        <TaskComplexity complexity={task.complexity} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <span
            className={`truncate text-sm font-medium ${
              task.completedAt ? "text-muted-foreground line-through" : ""
            }`}
          >
            {task.title}
          </span>
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">
              {task.package}
            </span>
            {task.metadata.objectivesProgress.total > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {task.metadata.objectivesProgress.completed}/
                {task.metadata.objectivesProgress.total}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Badge variant={priorityVariant(task.priority)} className="text-xs">
            {task.priority}
          </Badge>
          {task.priority === "high" && (
            <AlertTriangle className="size-3.5 text-red-500" />
          )}
          {task.priority === "optional" && (
            <Sparkles className="size-3.5 text-muted-foreground" />
          )}
        </div>
      </button>
    </div>
  );
};

export default KanbanCard;
