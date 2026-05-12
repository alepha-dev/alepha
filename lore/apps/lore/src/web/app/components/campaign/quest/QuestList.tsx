import { useI18n } from "alepha/react/i18n";
import { useMemo } from "react";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import QuestGroup from "./QuestGroup.tsx";

export interface QuestListProps {
  quests: QuestResource[];
}

const QuestList = (props: QuestListProps) => {
  const { tr } = useI18n<I18n, "en">();

  const groupByZone = useMemo(() => {
    const grouped: Record<string, QuestResource[]> = {};
    for (const quest of props.quests) {
      grouped[quest.zone] ??= [];
      grouped[quest.zone].push(quest);
    }
    return grouped;
  }, [props.quests]);

  const zoneList = useMemo(
    () => Object.keys(groupByZone).sort(),
    [groupByZone],
  );

  if (zoneList.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-3">
        <span className="text-muted-foreground text-sm">
          {tr("quest-log.empty")}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {zoneList.map((key) => (
        <QuestGroup key={key} name={key} quests={groupByZone[key]} />
      ))}
    </div>
  );
};

export default QuestList;
