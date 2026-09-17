import { useDialog, useToast } from "@alepha/ui";
import type { OrganizationInvitationController } from "alepha/api/organizations";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { I18n } from "@/web/app/services/I18n.ts";

/**
 * Take back a project invitation that has been sent but not answered, and
 * say so.
 *
 * The confirmation lives here rather than in the caller because it is part
 * of the action, not part of the layout: the invited person may already be
 * looking at the email, and the operation cannot be undone (a new
 * invitation is a new row with a new token, not a restored one). Sibling of
 * `useInviteMember`, and shaped the same way - it owns the confirm, the
 * mutation and the three toasts, returns whether anything happened, and
 * leaves the caller to decide what that means for its own UI.
 *
 * ⚠️ Revoking does not delete the invitation. The server flips it to
 * `revoked`, which is what makes the token dead, and the row disappears
 * from the settings page only because that page asks for `pending` ones.
 *
 * The verb is a `useAction` run (#E59): a refusal ("Invitation is not pending
 * (current status: accepted)", when someone accepted between the page load
 * and the click) is toasted by the root `ActionErrorToaster`, and `revoke`
 * resolves `undefined` for it.
 */
export const useRevokeInvitation = (): RevokeInvitation => {
  const invitationApi = useClient<OrganizationInvitationController>();
  const toaster = useToast();
  const dialog = useDialog();
  const { tr } = useI18n<I18n, "en">();
  const action = useAction<
    [organizationId: string, invitationId: string, email: string],
    boolean
  >(
    {
      handler: async (organizationId, invitationId, email) => {
        const confirmed = await dialog.confirm({
          title: tr("project.settings.members.revoke.title"),
          description: tr("project.settings.members.revoke.description", {
            args: [email],
          }),
          confirmLabel: tr("project.settings.members.revoke.confirm"),
          cancelLabel: tr("project.settings.members.revoke.cancel"),
          destructive: true,
        });
        if (!confirmed) return false;

        await invitationApi.revokeOrganizationInvitation({
          params: { organizationId, invitationId },
        });
        toaster.success(
          tr("project.settings.members.revoke.done", { args: [email] }),
        );
        return true;
      },
    },
    [invitationApi, dialog, toaster, tr],
  );

  return {
    revoke: action.run,
    loading: action.loading,
    can: invitationApi.revokeOrganizationInvitation.can(),
  };
};

export interface RevokeInvitation {
  /**
   * Resolves `true` when the invitation was revoked, `false` when the user
   * backed out of the confirmation, and `undefined` when the server refused.
   * Every time the user has already been told.
   *
   * `email` is only for the copy - it is what the person reading the dialog
   * needs to recognise the row they clicked. `projectId` is in the route
   * itself, and is what the server asserts ownership against.
   */
  revoke: (
    organizationId: string,
    invitationId: string,
    email: string,
  ) => Promise<boolean | undefined>;
  loading: boolean;
  /**
   * Whether this reader's rank may revoke. Beside the verb for the reason
   * {@link InviteMember.can} is.
   */
  can: boolean;
}
