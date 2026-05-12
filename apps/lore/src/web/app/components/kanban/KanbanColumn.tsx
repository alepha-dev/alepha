import { Button } from "@alepha/ui/components/ui/button";
import { useDroppable } from "@dnd-kit/core";
import { useI18n } from "alepha/react/i18n";
import { useMemo, useState } from "react";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { I18n } from "../../services/I18n.ts";
import KanbanCard from "./KanbanCard.tsx";

const PAGE_SIZE = 20;

type ColumnStatus = "new" | "accepted" | "completed";

export interface KanbanColumnProps {
  status: ColumnStatus;
  quests: QuestResource[];
  readOnly: boolean;
  last?: boolean;
  onSelect: (quest: QuestResource) => void;
}

const columnKeys = {
  new: "kanban.column.new",
  accepted: "kanban.column.accepted",
  completed: "kanban.column.completed",
} as const;

const columnDotClass: Record<ColumnStatus, string> = {
  new: "bg-blue-500",
  accepted: "bg-orange-500",
  completed: "bg-green-500",
};

const KanbanColumn = (props: KanbanColumnProps) => {
  const { status, quests, readOnly, last, onSelect } = props;
  const { tr } = useI18n<I18n, "en">();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status}`,
    data: { type: "column", status },
  });

  const visibleQuests = useMemo(
    () => quests.slice(0, visibleCount),
    [quests, visibleCount],
  );
  const hasMore = quests.length > visibleCount;

  return (
    <div
      className={`flex flex-1 flex-col overflow-hidden min-w-[280px] ${
        last ? "" : "border-border border-r"
      }`}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 border-border border-b px-3 py-2">
        <span
          className={`size-2 shrink-0 rounded-full ${columnDotClass[status]}`}
        />
        <span className="text-sm font-semibold">{tr(columnKeys[status])}</span>
        <span className="text-xs text-muted-foreground">{quests.length}</span>
      </div>

      {/* Column body — scrollable */}
      <div
        ref={setNodeRef}
        className={`flex-1 overflow-y-auto transition-colors ${
          isOver ? "bg-green-500/10" : ""
        }`}
      >
        <div className="flex min-h-[100px] flex-col gap-0.5 p-1">
          {quests.length === 0 && (
            <div className="flex items-center justify-center py-8 opacity-40">
              <span className="text-sm text-muted-foreground">
                {tr("kanban.empty")}
              </span>
            </div>
          )}
          {visibleQuests.map((quest) => (
            <KanbanCard
              key={quest.id}
              quest={quest}
              readOnly={readOnly}
              onSelect={onSelect}
            />
          ))}
          {hasMore && (
            <div className="flex justify-center py-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              >
                {tr("kanban.showMore")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default KanbanColumn;
