import { Button, useDialog } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { EpicController } from "../../../../../api/controllers/EpicController.ts";
import type { EpicResource } from "../../../../../api/schemas/epicResourceSchema.ts";
import { openQuestsOf } from "./epicStatus.ts";

export interface EpicShelveControlProps {
  epic: EpicResource;
  onChange: (epic: EpicResource) => void;
  /**
   * The query keys the move rewrites: this epic's quests, and the project's
   * quest and epic reads, so the quest list, the board and the agent prompt
   * gate do not show the old state.
   */
  invalidates: unknown[][];
}

/**
 * Shelve or Unshelve the whole epic (#E78, folio #1365), beside the status
 * control on the epic page.
 *
 * Shelve is offered while the epic is `draft`, `ready` or `in_progress`,
 * Unshelve while it is `shelved`, and nothing once it is `completed`. Both
 * confirm, because both move quests other people may be looking at: the
 * Shelve copy names how many open quests it sets aside (the epic's progress
 * already counts them), and the Unshelve copy names how many come back
 * (`progress.shelvedWithEpic`) and how.
 * A refusal is the server's sentence, toasted by the root
 * `ActionErrorToaster`.
 */
const EpicShelveControl = (props: EpicShelveControlProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const epicApi = useClient<EpicController>();
  const shelving = props.epic.status !== "shelved";

  const move = useAction<[], void>(
    {
      handler: async () => {
        const confirmed = shelving
          ? await dialog.confirm({
              title: tr("epic.shelve.title"),
              description: tr("epic.shelve.confirm", {
                args: [props.epic.title, String(openQuestsOf(props.epic))],
              }),
              confirmLabel: tr("epic.status.actions.shelve"),
              cancelLabel: tr("common.cancel"),
              destructive: true,
            })
          : await dialog.confirm({
              title: tr("epic.unshelve.title"),
              description: tr("epic.unshelve.confirm", {
                args: [
                  props.epic.title,
                  String(props.epic.progress.shelvedWithEpic ?? 0),
                ],
              }),
              confirmLabel: tr("epic.status.actions.unshelve"),
              cancelLabel: tr("common.cancel"),
            });
        if (!confirmed) return;

        const params = { params: { id: props.epic.id } };
        props.onChange(
          shelving
            ? await epicApi.shelveEpic(params)
            : await epicApi.unshelveEpic(params),
        );
      },
      invalidates: props.invalidates,
    },
    [epicApi, dialog, props.epic, props.onChange, shelving, tr],
  );

  if (props.epic.status === "completed") return null;
  const can = shelving ? epicApi.shelveEpic.can() : epicApi.unshelveEpic.can();
  if (!can) return null;

  return (
    <Button
      type="button"
      size="lg"
      variant="outlined"
      disabled={move.loading}
      onClick={() => void move.run()}
    >
      {tr(
        shelving
          ? "epic.status.actions.shelve"
          : "epic.status.actions.unshelve",
      )}
    </Button>
  );
};

export default EpicShelveControl;
