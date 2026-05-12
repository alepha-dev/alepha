import { Checkbox } from "@alepha/ui/components/ui/checkbox";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { ListChecks } from "lucide-react";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentAssignedQuestsAtom } from "@/web/app/atoms/currentAssignedQuestsAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface QuestViewObjectivesProps {
  quest: QuestResource;
  onQuestUpdate?: (updatedQuest: QuestResource) => void;
}

const QuestViewObjectives = (props: QuestViewObjectivesProps) => {
  const { quest, onQuestUpdate } = props;
  const { tr } = useI18n<I18n, "en">();
  const questApi = useClient<QuestController>();
  const [assignedQuests, setCurrentAssignedQuests] = useStore(
    currentAssignedQuestsAtom,
  );

  const handleObjectiveToggle = async (index: number) => {
    try {
      const updatedQuest = await questApi.completeObjective({
        params: { id: quest.id },
        body: { index },
      });
      onQuestUpdate?.(updatedQuest);
      setCurrentAssignedQuests(
        (assignedQuests ?? []).map((t) =>
          t.id === updatedQuest.id ? updatedQuest : t,
        ),
      );
    } catch (error) {
      console.error("Failed to update objective:", error);
    }
  };

  if (quest.objectives.length === 0) {
    return null;
  }

  const disabled = !!quest.completedAt || !quest.acceptedAt;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-center gap-2">
        <ListChecks className="size-5" />
        <span className="text-lg font-bold">{tr("quest.view.objectives")}</span>
        <div className="bg-border h-px w-full opacity-40" />
      </div>

      <div className="flex flex-col gap-2 px-3 py-2">
        {quest.objectives.map((objective, index) => (
          <label key={index} className="flex cursor-pointer items-center gap-2">
            <Checkbox
              checked={objective.completed}
              onCheckedChange={() => handleObjectiveToggle(index)}
              disabled={disabled}
            />
            <span
              className={
                objective.completed
                  ? "text-sm text-green-600 line-through"
                  : "text-sm"
              }
            >
              {objective.title}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
};

export default QuestViewObjectives;
