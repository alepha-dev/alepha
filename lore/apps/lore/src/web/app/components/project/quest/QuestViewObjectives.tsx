import { Checkbox } from "@alepha/ui/components/ui/checkbox";
import { useClient, useStore } from "alepha/react";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentAssignedQuestsAtom } from "@/web/app/atoms/currentAssignedQuestsAtom.ts";

export interface QuestViewObjectivesProps {
  quest: QuestResource;
  onQuestUpdate?: (updatedQuest: QuestResource) => void;
}

const QuestViewObjectives = (props: QuestViewObjectivesProps) => {
  const { quest, onQuestUpdate } = props;
  const questApi = useClient<QuestController>();
  const [assignedQuests, setCurrentAssignedQuests] = useStore(
    currentAssignedQuestsAtom,
  );

  const handleObjectiveToggle = async (objectiveId: number) => {
    try {
      const updatedQuest = await questApi.completeObjective({
        params: { id: quest.id },
        body: { objectiveId },
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
    <div className="flex flex-col gap-2 px-3 py-2">
      {quest.objectives.map((objective) => (
        // `objective.id` is always defined post-mapper (legacy rows are
        // backfilled with id = index server-side; new objectives get a
        // real id at create time). Falling back to title only as a
        // belt-and-braces key.
        <label
          key={objective.id ?? objective.title}
          className="flex cursor-pointer items-center gap-2"
        >
          <Checkbox
            checked={objective.completed}
            onCheckedChange={() =>
              objective.id != null && handleObjectiveToggle(objective.id)
            }
            disabled={disabled || objective.id == null}
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
  );
};

export default QuestViewObjectives;
