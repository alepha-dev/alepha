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
 * The lifecycle verb for the epic's current status: `planned` offers
 * "Begin", `active` offers "Conclude", `done` offers nothing.
 *
 * Two verbs, one way. Epic #31 made `setEpicStatus` a ratchet, so "Return
 * to Planning" and "Reopen" are gone along with their keys: the server
 * refuses both edges, and a button that answers 400 is worse than no
 * button. The way forward from a concluded epic is a new epic that depends
 * on it, which is what the Conclude dialog says.
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
 * ## Both verbs confirm, for two different reasons
 *
 * **Begin moves the backlog gate.** A `planned` epic hides its quests from
 * the project's backlog (`EpicVisibilityService`), so beginning one releases
 * them for everybody: it changes what other people see on a page they are
 * not looking at, which is the property worth a confirmation. Same copy as
 * the Epics list's row menu, from the same keys.
 *
 * **Conclude is a one-way door.** It used to confirm nothing, on the
 * reasoning that `active -> done` crossed no gate and could be undone, so a
 * dialog there would teach people to dismiss dialogs unread. It cannot be
 * undone any more, which is exactly what a confirmation is for, and the copy
 * says so plainly. The server also refuses to conclude while a quest is
 * open, and that refusal reaches the toast with its count.
 *
 * ## A blocked Begin says why
 *
 * `epics.dependsOn` is a gate since epic #31: Begin is refused while the
 * predecessor is not done. The button is disabled and captioned with the
 * blocking epic rather than left to fail on click, because until the aside
 * gained its predecessor row nothing on this page showed the field at all,
 * and a refusal for a reason nobody can see reads as a bug.
 */
const EpicStatusControl = (props: EpicStatusControlProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dialog = useDialog();
  const epicApi = useClient<EpicController>();
  const [submitting, setSubmitting] = useState(false);
  const blockedBy = epicBlockedBy(props.epic);

  const confirmFor = async (status: "active" | "done"): Promise<boolean> => {
    if (status === "active") {
      return await dialog.confirm({
        title: tr("epic.begin.title"),
        description: tr("epic.begin.confirm", {
          args: [props.epic.title],
        }) as string,
        confirmLabel: tr("epic.status.actions.begin"),
        cancelLabel: tr("common.cancel"),
      });
    }
    return await dialog.confirm({
      title: tr("epic.conclude.title"),
      description: tr("epic.conclude.confirm", {
        args: [props.epic.title],
      }) as string,
      confirmLabel: tr("epic.status.actions.conclude"),
      cancelLabel: tr("common.cancel"),
    });
  };

  const changeStatus = async (status: "active" | "done") => {
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

  if (props.epic.status === "done") {
    return null;
  }

  const blockedLabel =
    blockedBy !== undefined
      ? String(tr("epic.begin.blocked", { args: [String(blockedBy)] }))
      : undefined;

  return (
    <div className="flex items-center gap-2">
      {props.epic.status === "planned" && (
        <>
          {blockedLabel !== undefined && (
            <span className="text-muted-foreground text-xs">
              {blockedLabel}
            </span>
          )}
          <Button
            type="button"
            size="lg"
            disabled={submitting || blockedLabel !== undefined}
            title={blockedLabel}
            onClick={() => void changeStatus("active")}
          >
            {tr("epic.status.actions.begin")}
          </Button>
        </>
      )}
      {props.epic.status === "active" && (
        <Button
          type="button"
          size="lg"
          disabled={submitting}
          onClick={() => void changeStatus("done")}
        >
          {tr("epic.status.actions.conclude")}
        </Button>
      )}
    </div>
  );
};

export default EpicStatusControl;
