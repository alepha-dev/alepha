import { Checkbox } from "@alepha/ui/components/ui/checkbox";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { SquareSlash } from "lucide-react";
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
  const questApi = useClient<QuestController>();
  const { tr } = useI18n<I18n, "en">();
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
          className="flex cursor-pointer items-start gap-2"
        >
          <Checkbox
            checked={objective.completed}
            onCheckedChange={() =>
              objective.id != null && handleObjectiveToggle(objective.id)
            }
            disabled={disabled || objective.id == null}
            className="mt-0.5"
          />
          <span className="flex min-w-0 flex-col gap-0.5">
            {/* Done is muted and struck through, not green. Green reads as a
                status worth noticing, and a ticked objective is the opposite:
                the strike already says it is handled, so the row should recede
                and leave the unticked ones as the ones that stand out.

                A waived one is deliberately NOT struck through: the box stays
                visibly empty, because the work did not happen. What it gets
                instead is the reason underneath. */}
            <span
              className={
                objective.completed
                  ? "text-muted-foreground text-sm line-through"
                  : "text-sm"
              }
            >
              {objective.title}
            </span>
            {objective.waivedReason && (
              <span className="text-muted-foreground flex items-start gap-1 text-xs">
                <SquareSlash className="mt-0.5 size-3 shrink-0" />
                <span className="min-w-0">
                  <span className="font-medium">
                    {tr("quest.view.objectives.waived")}
                  </span>{" "}
                  {objective.waivedReason}
                </span>
              </span>
            )}
          </span>
        </label>
      ))}
    </div>
  );
};

export default QuestViewObjectives;
