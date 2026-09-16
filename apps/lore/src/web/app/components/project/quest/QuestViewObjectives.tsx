import { Checkbox } from "@alepha/ui";
import { useAction, useClient, useStore } from "alepha/react";
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

  // A `useAction` (#E59, #Q2328). The checkbox is driven by
  // `quest.objectives`, which a refused toggle never gets to replace, so the
  // box is already back where it was; the root `ActionErrorToaster` says why,
  // in the server's words. Every box is disabled while a toggle runs, so a
  // second tick is refused visibly rather than dropped by `run()`.
  const toggleAction = useAction<[objectiveId: number], void>(
    {
      handler: async (objectiveId) => {
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
      },
    },
    [questApi, quest.id, onQuestUpdate, assignedQuests],
  );

  if (quest.objectives.length === 0) {
    return null;
  }

  // A checkbox nobody may tick is disabled rather than hidden: the objective
  // list IS the quest's content, and removing the boxes would leave a reader
  // unable to see how much of it is done.
  const disabled =
    !!quest.completedAt ||
    !quest.acceptedAt ||
    !questApi.completeObjective.can() ||
    toggleAction.loading;

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
            onCheckedChange={() => void toggleAction.run(objective.id)}
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
