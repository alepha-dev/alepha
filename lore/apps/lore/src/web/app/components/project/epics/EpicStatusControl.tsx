import { Button } from "@alepha/ui/components/ui/button";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { EpicController } from "@/api/controllers/EpicController.ts";
import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
export interface EpicStatusControlProps {
  epic: EpicResource;
  onChange: (epic: EpicResource) => void;
}

/**
 * The lifecycle-verb buttons for the epic's current status, following the
 * vocabulary table in the design doc: `planned` only offers "Begin", `active`
 * offers both "Conclude" and "Return to Planning", `done` only offers
 * "Reopen". There is no direct `planned <-> done` button — that always goes
 * through `active`, matching the four named transitions.
 *
 * It renders the verbs and NOT the status badge. The badge moved to
 * `ProjectEpicAside` when the page went to a `DetailLayout`: the aside states
 * what the epic currently is, and this toolbar control changes it. Keeping a
 * badge here too would have put the same fact on screen twice, a hand's width
 * apart.
 *
 * `submitting` guards against a double-click firing two overlapping
 * `setEpicStatus` calls, the same way `ProjectEpics.tsx`'s `submitCreate`
 * guards its own in-flight request.
 *
 * ## Which verbs confirm, and why it is not arbitrary
 *
 * **Begin and Return to Planning confirm. Conclude and Reopen do not.**
 *
 * The line is not how important the transition feels, it is whether it moves
 * the BACKLOG GATE. A `planned` epic hides its quests from the project's
 * backlog (`EpicVisibilityService`), so beginning one releases them for
 * everybody and returning one to planning withdraws them again. Both change
 * what other people see on a page they are not looking at, which is the
 * property worth a confirmation.
 *
 * `active -> done` and `done -> active` cross no gate: the quests stay
 * exactly as visible as they were, so a dialog there would be a click asking
 * "are you sure you meant to click that", which teaches people to dismiss
 * dialogs unread.
 */
const EpicStatusControl = (props: EpicStatusControlProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dialog = useDialog();
  const epicApi = useClient<EpicController>();
  const [submitting, setSubmitting] = useState(false);

  /**
   * The two gate-moving transitions ask first. Same copy as the Epics list's
   * row menu, from the same keys, so the two entry points into `Begin`
   * cannot come to describe it differently.
   */
  const confirmFor = async (
    status: "planned" | "active" | "done",
  ): Promise<boolean> => {
    if (status === "active" && props.epic.status === "planned") {
      return await dialog.confirm({
        title: tr("epic.begin.title"),
        description: tr("epic.begin.confirm", {
          args: [props.epic.title],
        }) as string,
        confirmLabel: tr("epic.status.actions.begin"),
        cancelLabel: tr("common.cancel"),
      });
    }
    if (status === "planned") {
      return await dialog.confirm({
        title: tr("epic.returnToPlanning.title"),
        description: tr("epic.returnToPlanning.confirm", {
          args: [props.epic.title],
        }) as string,
        confirmLabel: tr("epic.status.actions.returnToPlanning"),
        cancelLabel: tr("common.cancel"),
      });
    }
    return true;
  };

  const changeStatus = async (status: "planned" | "active" | "done") => {
    if (submitting) return;
    if (!(await confirmFor(status))) return;
    setSubmitting(true);
    try {
      const updated = await epicApi.setEpicStatus({
        params: { id: props.epic.id },
        body: { status },
      });
      props.onChange(updated);
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {props.epic.status === "planned" && (
        <Button
          type="button"
          size="lg"
          disabled={submitting}
          onClick={() => void changeStatus("active")}
        >
          {tr("epic.status.actions.begin")}
        </Button>
      )}
      {props.epic.status === "active" && (
        <>
          <Button
            type="button"
            size="lg"
            variant="outline"
            disabled={submitting}
            onClick={() => void changeStatus("planned")}
          >
            {tr("epic.status.actions.returnToPlanning")}
          </Button>
          <Button
            type="button"
            size="lg"
            disabled={submitting}
            onClick={() => void changeStatus("done")}
          >
            {tr("epic.status.actions.conclude")}
          </Button>
        </>
      )}
      {props.epic.status === "done" && (
        <Button
          type="button"
          size="lg"
          variant="outline"
          disabled={submitting}
          onClick={() => void changeStatus("active")}
        >
          {tr("epic.status.actions.reopen")}
        </Button>
      )}
    </div>
  );
};

export default EpicStatusControl;
