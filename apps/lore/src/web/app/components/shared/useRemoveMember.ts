import { useDialog, useToast } from "@alepha/ui";
import type { MemberController } from "alepha/api/organizations";
import { useAction, useClient, useQueryClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

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
 *
 * The verb is a `useAction` run (#E59): a refusal is toasted by the root
 * `ActionErrorToaster` with the server's message ("The owner cannot be
 * removed from their own project" says the whole thing), and `remove`
 * resolves `undefined` for it.
 */
export const useRemoveMember = (): RemoveMember => {
  const memberApi = useClient<MemberController>();
  const toaster = useToast();
  const dialog = useDialog();
  const { tr } = useI18n<I18n, "en">();
  const queries = useQueryClient();

  const action = useAction<
    [organizationId: string, userId: string, name: string],
    boolean
  >(
    {
      handler: async (organizationId, userId, name) => {
        const confirmed = await dialog.confirm({
          title: tr("project.settings.members.remove.title"),
          description: tr("project.settings.members.remove.description", {
            args: [name],
          }),
          confirmLabel: tr("project.settings.members.remove.confirm"),
          cancelLabel: tr("project.settings.members.remove.cancel"),
          destructive: true,
        });
        if (!confirmed) return false;

        await memberApi.removeOrganizationMember({
          params: { organizationId, userId },
        });
        // By hand rather than through `invalidates`: the key carries the
        // project the member left, which only the arguments know.
        queries.invalidate(["organization-members", organizationId]);
        toaster.success(
          tr("project.settings.members.remove.done", { args: [name] }),
        );
        return true;
      },
    },
    [memberApi, dialog, queries, toaster, tr],
  );

  return { remove: action.run, loading: action.loading };
};

export interface RemoveMember {
  /**
   * Resolves `true` when the member was removed, `false` when the owner
   * backed out of the confirmation, and `undefined` when the server refused.
   * Every time they have already been told.
   *
   * `name` is only for the copy - it is what the person reading the dialog
   * needs to recognise the row they clicked.
   */
  remove: (
    organizationId: string,
    userId: string,
    name: string,
  ) => Promise<boolean | undefined>;
  loading: boolean;
}
