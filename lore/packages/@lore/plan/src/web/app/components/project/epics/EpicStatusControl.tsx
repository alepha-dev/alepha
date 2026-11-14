import { Button, useDialog } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { EpicController } from "../../../../../api/controllers/EpicController.ts";
import type { EpicResource } from "../../../../../api/schemas/epicResourceSchema.ts";
import { epicBlockedBy } from "./epicStatus.ts";

export interface EpicStatusControlProps {
  epic: EpicResource;
  onChange: (epic: EpicResource) => void;
  /**
   * Show the epic's Review tab: where the confirm sends a reader who backs
   * out of marking an epic ready with review questions still open.
   */
  onReview?: () => void;
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
 * The write is a `useAction` (#E59, #Q2326): `run()` drops a double click
 * while the first call is in flight, the button is disabled for that time,
 * and a refusal is the server's sentence, toasted by the root
 * `ActionErrorToaster`.
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
 * ## Open review questions are named, never a refusal (#E121)
 *
 * With review questions still open, the confirm says how many and offers
 * the Review tab as the way out; marking it ready anyway stays one click.
 * The server never refuses on them either (`epic_set_status` reports the
 * count beside the new status).
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
  const dialog = useDialog();
  const epicApi = useClient<EpicController>();
  const blockedBy = epicBlockedBy(props.epic);

  const changeAction = useAction<[status: "draft" | "ready"], void>(
    {
      handler: async (_ctx, status) => {
        const open = props.epic.openQuestions ?? 0;
        if (status === "ready" && open > 0) {
          // Asks, never refuses (#E121): whether the spec is done is the
          // owner's call, so the open questions are named and the reader
          // decides. Backing out opens the Review tab, where they are.
          const ok = await dialog.confirm({
            title:
              open === 1
                ? tr("epic.ready.openQuestions.title.one")
                : tr("epic.ready.openQuestions.title", {
                    args: [String(open)],
                  }),
            description: tr("epic.ready.openQuestions.confirm", {
              args: [props.epic.title],
            }),
            confirmLabel: tr("epic.ready.openQuestions.anyway"),
            cancelLabel: tr("epic.ready.openQuestions.review"),
          });
          if (!ok) {
            props.onReview?.();
            return;
          }
        } else if (
          status === "ready" &&
          !(await dialog.confirm({
            title: tr("epic.ready.title"),
            description: tr("epic.ready.confirm", {
              args: [props.epic.title],
            }),
            confirmLabel: tr("epic.status.actions.markReady"),
            cancelLabel: tr("common.cancel"),
          }))
        ) {
          return;
        }
        props.onChange(
          await epicApi.setEpicStatus({
            params: { id: props.epic.id },
            body: { status },
          }),
        );
      },
    },
    [
      epicApi,
      dialog,
      props.epic.id,
      props.epic.title,
      props.epic.openQuestions,
      props.onChange,
      props.onReview,
      tr,
    ],
  );
  const submitting = changeAction.loading;

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
      ? tr("epic.start.blocked", { args: [String(blockedBy)] })
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
          onClick={() => void changeAction.run("ready")}
        >
          {tr("epic.status.actions.markReady")}
        </Button>
      ) : (
        <Button
          type="button"
          size="lg"
          variant="outlined"
          disabled={submitting}
          onClick={() => void changeAction.run("draft")}
        >
          {tr("epic.status.actions.backToDraft")}
        </Button>
      )}
    </div>
  );
};

export default EpicStatusControl;
