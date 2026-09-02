import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

/**
 * Remove somebody from a project, and say so.
 *
 * Sibling of `useRevokeInvitation` and shaped the same way, for the same
 * reason: the confirmation is part of the action rather than part of the
 * layout. It owns the confirm, the mutation and the toasts, returns whether
 * anything happened, and leaves the caller to decide what that means for its
 * own UI.
 *
 * The confirmation says what happens to the person's work, because it is not
 * guessable and it is not undoable: their unfinished quests go back to the
 * pool, and the finished ones stay theirs.
 */
export const useRemoveMember = (): RemoveMember => {
  const projectApi = useClient<ProjectController>();
  const toaster = useToast();
  const dialog = useDialog();
  const { tr } = useI18n<I18n, "en">();
  const [loading, setLoading] = useState(false);

  const remove = async (projectId: number, userId: string, name: string) => {
    const confirmed = await dialog.confirm({
      title: String(tr("project.settings.members.remove.title")),
      description: String(
        tr("project.settings.members.remove.description", { args: [name] }),
      ),
      confirmLabel: String(tr("project.settings.members.remove.confirm")),
      cancelLabel: String(tr("project.settings.members.remove.cancel")),
      destructive: true,
    });
    if (!confirmed) return false;

    setLoading(true);
    try {
      await projectApi.removeMember({ params: { id: projectId, userId } });
      toaster.success(
        String(tr("project.settings.members.remove.done", { args: [name] })),
      );
      return true;
    } catch (error: any) {
      // The server's own message wins when there is one, same as its
      // sibling: "The owner cannot be removed from their own project" says
      // the whole thing, and the catalogue string is the fallback for a
      // failure with nothing to say.
      toaster.error(
        error?.message ?? String(tr("project.settings.members.remove.failed")),
      );
      return false;
    } finally {
      setLoading(false);
    }
  };

  return { remove, loading };
};

export interface RemoveMember {
  /**
   * Resolves `true` when the member was removed, `false` when the owner
   * backed out of the confirmation or the server refused. Either way they
   * have already been told.
   *
   * `name` is only for the copy - it is what the person reading the dialog
   * needs to recognise the row they clicked.
   */
  remove: (projectId: number, userId: string, name: string) => Promise<boolean>;
  loading: boolean;
}
