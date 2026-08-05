import { Badge } from "@alepha/ui/components/ui/badge";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, Sparkles } from "lucide-react";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import QuestDifficulty from "../project/quest/QuestDifficulty.tsx";

export interface KanbanCardProps {
  quest: QuestResource;
  onSelect: (quest: QuestResource) => void;
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
  const { quest, onSelect } = props;
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `quest-${quest.id}`,
      data: { type: "quest", quest },
    });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : undefined,
  };

  const cursorClass = isDragging ? "cursor-grabbing" : "cursor-grab";

  return (
    <div ref={setNodeRef} style={style} className="p-1">
      <button
        type="button"
        onClick={() => onSelect(quest)}
        {...attributes}
        {...listeners}
        className={`group flex w-full items-center gap-2 overflow-hidden rounded-md border border-border bg-card px-2 py-1.5 text-left shadow-sm transition-colors hover:bg-muted ${cursorClass}`}
      >
        <QuestDifficulty difficulty={quest.difficulty} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <span
            className={`truncate text-sm font-medium ${
              quest.completedAt ? "text-muted-foreground line-through" : ""
            }`}
          >
            {quest.title}
          </span>
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-mono text-muted-foreground/70">
              #{quest.shortId}
            </span>
            <span className="text-xs text-muted-foreground">{quest.zone}</span>
            {quest.metadata.objectivesProgress.total > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {quest.metadata.objectivesProgress.completed}/
                {quest.metadata.objectivesProgress.total}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Badge variant={priorityVariant(quest.priority)} className="text-xs">
            {quest.priority}
          </Badge>
          {quest.priority === "high" && (
            <AlertTriangle className="size-3.5 text-red-500" />
          )}
          {quest.priority === "optional" && (
            <Sparkles className="size-3.5 text-muted-foreground" />
          )}
        </div>
      </button>
    </div>
  );
};

export default KanbanCard;
