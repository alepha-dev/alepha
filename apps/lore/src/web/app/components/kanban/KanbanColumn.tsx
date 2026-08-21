import { Button } from "@alepha/ui/components/ui/button";
import { useDroppable } from "@dnd-kit/core";
import { useI18n } from "alepha/react/i18n";
import { useMemo, useState } from "react";

import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";

import type { I18n } from "../../services/I18n.ts";
import KanbanCard from "./KanbanCard.tsx";

const PAGE_SIZE = 20;

export type ColumnKind = "new" | "accepted" | "completed";

export interface ColumnDescriptor {
  /** Stable droppable id. */
  key: string;
  kind: ColumnKind;
  /** Free-form sub-column name when `kind === "accepted"`. */
  subColumn?: string;
  /** Display label (already translated). */
  label: string;
  /** Tailwind class for the small status dot in the header. */
  dotClass: string;
}

export interface KanbanColumnProps {
  descriptor: ColumnDescriptor;
  quests: QuestResource[];
  last?: boolean;
  onSelect: (quest: QuestResource) => void;
}

const KanbanColumn = (props: KanbanColumnProps) => {
  const { descriptor, quests, last, onSelect } = props;
  const { tr } = useI18n<I18n, "en">();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const { setNodeRef, isOver } = useDroppable({
    id: descriptor.key,
    data: {
      type: "column",
      kind: descriptor.kind,
      subColumn: descriptor.subColumn,
    },
  });

  const visibleQuests = useMemo(
    () => quests.slice(0, visibleCount),
    [quests, visibleCount],
  );
  const hasMore = quests.length > visibleCount;

  return (
    <div
      className={`flex flex-1 flex-col overflow-hidden min-w-[260px] ${
        last ? "" : "border-border border-r"
      }`}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 border-border border-b px-3 py-2">
        <span
          className={`size-2 shrink-0 rounded-full ${descriptor.dotClass}`}
        />
        <span className="text-sm font-semibold truncate">
          {descriptor.label}
        </span>
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
            <KanbanCard key={quest.id} quest={quest} onSelect={onSelect} />
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
