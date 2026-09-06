import { Checkbox } from "@alepha/ui/components/ui/checkbox";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
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
  const toaster = useToast();
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
    } catch {
      // The checkbox is driven by `quest.objectives`, which this never got to
      // replace, so the box is already back where it was. What was missing is
      // any sign that it moved back on purpose.
      toaster.error(tr("quest.objective.error"));
    }
  };

  if (quest.objectives.length === 0) {
    return null;
  }

  const disabled = !!quest.completedAt || !quest.acceptedAt;

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      {quest.objectives.map((objective) => (
        // `cursor-pointer` stays: the global cursor rule in
        // `@alepha/ui/src/styles.css` covers controls and menu items, and a
        // `<label>` is neither. The row is the click target, not the Checkbox.
        <label
          key={objective.id}
          className="flex cursor-pointer items-start gap-2"
        >
          <Checkbox
            checked={objective.completed}
            onCheckedChange={() => handleObjectiveToggle(objective.id)}
            disabled={disabled}
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
