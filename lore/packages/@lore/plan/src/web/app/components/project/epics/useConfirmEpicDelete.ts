import { useDialog } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { EpicResource } from "../../../../../api/schemas/epicResourceSchema.ts";

/**
 * The one confirm asked before an epic is deleted, from the list's row menu
 * and from the epic page's menu (#Q3908), so the two cannot come to say
 * different things.
 *
 * Deleting an epic deletes its quests (#Q2666), so it says how many, and that
 * the folios stay. Resolves `true` when the reader confirmed.
 */
export const useConfirmEpicDelete = () => {
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  return (epic: Pick<EpicResource, "title" | "progress">): Promise<boolean> =>
    dialog.confirm({
      title: tr("epic.delete.title"),
      description: tr("epic.delete.confirm", {
        args: [epic.title, String(epic.progress.total)],
      }),
      confirmLabel: tr("epic.action.delete"),
      cancelLabel: tr("common.cancel"),
      destructive: true,
    });
};
