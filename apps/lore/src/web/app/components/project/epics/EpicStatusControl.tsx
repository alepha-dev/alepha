import { Button } from "@alepha/ui/components/ui/button";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { EpicController } from "@/api/controllers/EpicController.ts";
import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { epicBlockedBy } from "./epicStatus.ts";

export interface EpicStatusControlProps {
  epic: EpicResource;
  onChange: (epic: EpicResource) => void;
}

/**
 * The one lifecycle decision a person makes: `draft` offers "Mark as
 * ready", `ready` offers "Back to draft", and an epic that has started or
 * completed offers nothing.
 *
 * Two verbs because there are only two hand-set statuses (#Q2223). The epic
 * moves to `in_progress` when its first quest is accepted or assigned, and
 * to `completed` when its last open quest is completed or shelved, so a
 * button for either would be a click that restates something the server
 * already knows. That is what Begin and Conclude turned out to be.
 *
 * It renders the verb and NOT the status badge. The badge lives in
 * `ProjectEpicAside`: the aside states what the epic currently is, and this
 * toolbar control changes it. Keeping a badge here too would put the same
 * fact on screen twice, a hand's width apart.
 *
 * `submitting` guards against a double-click firing two overlapping
 * `setEpicStatus` calls, the same way `ProjectEpics.tsx`'s `submitCreate`
 * guards its own in-flight request.
 *
 * ## Mark as ready confirms, Back to draft does not
 *
 * **Ready moves the backlog gate.** A `draft` epic hides its quests from
 * the project's backlog (`EpicVisibilityService`), so marking it ready
 * releases them for everybody: it changes what other people see on a page
 * they are not looking at, and the first of them to accept a quest freezes
 * the plan. That is worth a confirmation, and the copy says both. Same copy
 * as the Epics list's row menu, from the same keys.
 *
 * **Back to draft is the safe direction.** It hides quests nobody has
 * started yet (a ready epic with an accepted quest is already in progress),
 * and the next click undoes it.
 *
 * ## A blocked epic says why
 *
 * `epics.dependsOn` gates the start: no quest of a ready epic is accepted
 * while its predecessor is not completed. Marking it ready is still allowed,
 * so a chain can be specified together, and the caption beside the control
 * says what the epic is waiting for rather than leaving the refusal to
 * surprise whoever accepts the first quest.
 */
const EpicStatusControl = (props: EpicStatusControlProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dialog = useDialog();
  const epicApi = useClient<EpicController>();
  const [submitting, setSubmitting] = useState(false);
  const blockedBy = epicBlockedBy(props.epic);

  const changeStatus = async (status: "draft" | "ready") => {
    if (submitting) return;
    if (
      status === "ready" &&
      !(await dialog.confirm({
        title: tr("epic.ready.title"),
        description: tr("epic.ready.confirm", {
          args: [props.epic.title],
        }) as string,
        confirmLabel: tr("epic.status.actions.markReady"),
        cancelLabel: tr("common.cancel"),
      }))
    ) {
      return;
    }
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

  if (props.epic.status !== "draft" && props.epic.status !== "ready") {
    return null;
  }

  // The whole control, not each button: an epic's status is not something a
  // rank without `epic:write` can move at all.
  if (!epicApi.setEpicStatus.can()) {
    return null;
  }

  const blockedLabel =
    blockedBy !== undefined
      ? String(tr("epic.start.blocked", { args: [String(blockedBy)] }))
      : undefined;

  return (
    <div className="flex items-center gap-2">
      {blockedLabel !== undefined && (
        <span className="text-muted-foreground text-xs">{blockedLabel}</span>
      )}
      {props.epic.status === "draft" ? (
        <Button
          type="button"
          size="lg"
          disabled={submitting}
          onClick={() => void changeStatus("ready")}
        >
          {tr("epic.status.actions.markReady")}
        </Button>
      ) : (
        <Button
          type="button"
          size="lg"
          variant="outline"
          disabled={submitting}
          onClick={() => void changeStatus("draft")}
        >
          {tr("epic.status.actions.backToDraft")}
        </Button>
      )}
    </div>
  );
};

export default EpicStatusControl;
