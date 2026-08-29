import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { InvitationController } from "@/api/controllers/InvitationController.ts";
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
 */
export const useRevokeInvitation = (): RevokeInvitation => {
  const invitationApi = useClient<InvitationController>();
  const toaster = useToast();
  const dialog = useDialog();
  const { tr } = useI18n<I18n, "en">();
  const [loading, setLoading] = useState(false);

  const revoke = async (
    projectId: number,
    invitationId: string,
    email: string,
  ) => {
    const confirmed = await dialog.confirm({
      title: String(tr("project.settings.members.revoke.title")),
      description: String(
        tr("project.settings.members.revoke.description", { args: [email] }),
      ),
      confirmLabel: String(tr("project.settings.members.revoke.confirm")),
      cancelLabel: String(tr("project.settings.members.revoke.cancel")),
      destructive: true,
    });
    if (!confirmed) return false;

    setLoading(true);
    try {
      await invitationApi.revokeProjectInvitation({
        params: { projectId, id: invitationId },
      });
      toaster.success(
        String(tr("project.settings.members.revoke.done", { args: [email] })),
      );
      return true;
    } catch (error: any) {
      // The server's own message wins when there is one, same as
      // `useInviteMember`: "Invitation is not pending (current status:
      // accepted)" is the whole story when someone accepted between the
      // page load and the click, and the catalog string is only the
      // fallback for a failure with nothing to say.
      toaster.error(
        error?.message ?? String(tr("project.settings.members.revoke.failed")),
      );
      return false;
    } finally {
      setLoading(false);
    }
  };

  return { revoke, loading };
};

export interface RevokeInvitation {
  /**
   * Resolves `true` when the invitation was revoked, `false` when the user
   * backed out of the confirmation or the server refused. Either way the
   * user has already been told.
   *
   * `email` is only for the copy - it is what the person reading the dialog
   * needs to recognise the row they clicked. `projectId` is in the route
   * itself, and is what the server asserts ownership against.
   */
  revoke: (
    projectId: number,
    invitationId: string,
    email: string,
  ) => Promise<boolean>;
  loading: boolean;
}
