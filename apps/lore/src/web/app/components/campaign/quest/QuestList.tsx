import { useI18n } from "alepha/react/i18n";
import { ScrollText } from "lucide-react";
import { useMemo } from "react";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import QuestGroup from "./QuestGroup.tsx";

export interface QuestListProps {
  quests: QuestResource[];
  collapseSignal?: { collapsed: boolean; version: number };
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
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="bg-muted text-muted-foreground inline-flex size-12 items-center justify-center rounded-full">
          <ScrollText className="size-5" />
        </div>
        <h3 className="text-sm font-semibold">{tr("quest-log.empty")}</h3>
        <p className="text-muted-foreground max-w-[13rem] text-xs">
          {tr("quest-log.empty-description")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {zoneList.map((key) => (
        <QuestGroup
          key={key}
          name={key}
          quests={groupByZone[key]}
          collapseSignal={props.collapseSignal}
        />
      ))}
    </div>
  );
};

export default QuestList;
