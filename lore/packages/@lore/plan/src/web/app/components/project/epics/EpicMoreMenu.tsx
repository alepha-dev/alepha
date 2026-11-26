import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  useDialog,
} from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Archive, ArchiveRestore, MoreVertical, Trash2 } from "lucide-react";

import type { EpicController } from "../../../../../api/controllers/EpicController.ts";
import type { EpicResource } from "../../../../../api/schemas/epicResourceSchema.ts";
import { isDeletable, openQuestsOf } from "./epicStatus.ts";
import { useConfirmEpicDelete } from "./useConfirmEpicDelete.ts";

export interface EpicMoreMenuProps {
  epic: EpicResource;
  onChange: (epic: EpicResource) => void;
  /**
   * Called once the epic is deleted: the page goes back to the epics list.
   */
  onDeleted: () => void;
  /**
   * The query keys a move rewrites: this epic's quests, and the project's
   * quest and epic reads, so the quest list, the board and the agent prompt
   * gate do not show the old state.
   */
  invalidates: unknown[][];
}

/**
 * The three-dots menu at the end of the epic page's actions (#Q3908): what a
 * reader does rarely, behind one button, as a list's row menu keeps it.
 *
 * - **Shelve** while the epic is `draft`, `ready` or `in_progress`,
 *   **Unshelve** while it is `shelved` (#E78, folio #1365). Both confirm,
 *   because both move quests other people may be looking at: the Shelve copy
 *   names how many open quests it sets aside, the Unshelve copy how many come
 *   back (`progress.shelvedWithEpic`).
 * - **Delete** while the plan is open, `draft` or `ready`, the server's own
 *   rule (#Q2666), with the list's confirm (`useConfirmEpicDelete`).
 *
 * Each entry keeps its own permission, and the menu is absent when no entry
 * is left: a completed epic, or a reader whose rank allows neither.
 * A refusal is the server's sentence, toasted by the root
 * `ActionErrorToaster`.
 */
const EpicMoreMenu = (props: EpicMoreMenuProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const confirmDelete = useConfirmEpicDelete();
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

  const remove = useAction<[], void>(
    {
      handler: async () => {
        if (!(await confirmDelete(props.epic))) return;
        await epicApi.deleteEpic({ params: { id: props.epic.id } });
        props.onDeleted();
      },
      invalidates: props.invalidates,
    },
    [epicApi, confirmDelete, props.epic, props.onDeleted],
  );

  const canMove =
    props.epic.status !== "completed" &&
    (shelving ? epicApi.shelveEpic.can() : epicApi.unshelveEpic.can());
  const canDelete = isDeletable(props.epic) && epicApi.deleteEpic.can();
  if (!canMove && !canDelete) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="minimal"
            size="icon"
            disabled={move.loading || remove.loading}
            aria-label={tr("epic.more")}
            title={tr("epic.more")}
            data-testid="epic-more"
          />
        }
      >
        <MoreVertical className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canMove && (
          <DropdownMenuItem onClick={() => void move.run()}>
            {shelving ? (
              <Archive className="size-4" />
            ) : (
              <ArchiveRestore className="size-4" />
            )}
            {tr(
              shelving
                ? "epic.status.actions.shelve"
                : "epic.status.actions.unshelve",
            )}
          </DropdownMenuItem>
        )}
        {canDelete && (
          <DropdownMenuItem
            variant="destructive"
            onClick={() => void remove.run()}
          >
            <Trash2 className="size-4" />
            {tr("epic.action.delete")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default EpicMoreMenu;
