import { Button } from "@alepha/ui/components/ui/button";
import { useI18n } from "alepha/react/i18n";
import { Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import QuestItem from "./QuestItem.tsx";

export interface QuestGroupProps {
  name: string;
  quests: QuestResource[];
  /**
   * Optional broadcast from QuestLog: when `version` changes, the group
   * snaps its expanded state to `!collapsed`.
   */
  collapseSignal?: { collapsed: boolean; version: number };
}

const QuestGroup = (props: QuestGroupProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [isExpanded, setIsExpanded] = useState(true);

  const collapseVersion = props.collapseSignal?.version ?? 0;
  const collapseCollapsed = props.collapseSignal?.collapsed ?? false;
  // Apply the global directive when its version bumps. Local toggles still
  // override afterwards until the next bump.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally
  // versioned — we only react when the version changes.
  useEffect(() => {
    if (!props.collapseSignal) return;
    setIsExpanded(!collapseCollapsed);
  }, [collapseVersion]);

  const quests = [...props.quests].sort((a, b) =>
    a.difficulty - b.difficulty > 0 ? -1 : 1,
  );

  const count = props.quests.length;
  const countLabel =
    count === 1
      ? tr("quest.group.quests.one")
      : tr("quest.group.quests", { args: [String(count)] });

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2 px-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? (
            <Minus className="size-3" />
          ) : (
            <Plus className="size-3" />
          )}
        </Button>
        <span className="text-sm font-bold">{props.name}</span>
        <div className="bg-border h-px flex-1 opacity-30" />
        <span className="text-muted-foreground text-sm">{countLabel}</span>
      </div>
      {isExpanded && (
        <div className="flex flex-col gap-0.5">
          {quests.map((item, index) => (
            <QuestItem key={item.id} quest={item} index={index} />
          ))}
        </div>
      )}
    </div>
  );
};

export default QuestGroup;
