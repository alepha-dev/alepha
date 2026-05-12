import { Button } from "@alepha/ui/components/ui/button";
import { useI18n } from "alepha/react/i18n";
import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import QuestItem from "./QuestItem.tsx";
import { openRenameZoneModal } from "./RenameZoneModal.tsx";

export interface QuestGroupProps {
  name: string;
  quests: QuestResource[];
}

const QuestGroup = (props: QuestGroupProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [isExpanded, setIsExpanded] = useState(true);

  const quests = [...props.quests].sort((a, b) =>
    a.difficulty - b.difficulty > 0 ? -1 : 1,
  );

  const handleRenameZone = (e: React.MouseEvent) => {
    e.stopPropagation();
    openRenameZoneModal(props.name);
  };

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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2"
          onClick={handleRenameZone}
        >
          <span className="text-sm font-bold">{props.name}</span>
        </Button>
        <div className="bg-border h-px flex-1 opacity-30" />
        <span className="text-muted-foreground text-sm">
          {tr("quest.group.quests", { args: [String(props.quests.length)] })}
        </span>
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
