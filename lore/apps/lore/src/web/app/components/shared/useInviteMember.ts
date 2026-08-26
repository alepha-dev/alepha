import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { InvitationController } from "@/api/controllers/InvitationController.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

/**
 * Send a project invitation, and say so.
 *
 * There are two entry points to the same action - the header's create menu
 * and the members settings card - and they had grown a copy each of the
 * mutation, the blank-email guard and three hardcoded English toasts. The
 * duplication is what kept the strings out of the catalog: a string written
 * twice gets translated zero times, because neither copy looks like the one
 * that matters.
 *
 * The hook owns everything the two agree on and nothing they do not: it
 * returns whether the invite went through, and each caller decides what that
 * means for its own UI (clear the field, close the dialog, re-run the loader
 * for the new pending row).
 */
export const useInviteMember = (): InviteMember => {
  const invitationApi = useClient<InvitationController>();
  const toaster = useToast();
  const { tr } = useI18n<I18n, "en">();
  const [loading, setLoading] = useState(false);

  const invite = async (projectId: number, email: string) => {
    const trimmed = email.trim();
    if (!trimmed) {
      toaster.error(
        String(tr("project.settings.members.invite.emailRequired")),
      );
      return false;
    }
    setLoading(true);
    try {
      await invitationApi.createInvitation({
        body: {
          email: trimmed,
          resourceType: "project",
          resourceId: String(projectId),
        },
      });
      toaster.success(
        String(tr("project.settings.members.invite.sent", { args: [trimmed] })),
      );
      return true;
    } catch (error: any) {
      // The server's own message wins when there is one: it carries the real
      // reason (already a member, pending invitation, project full) and the
      // catalog string is only the fallback for a failure with no story.
      toaster.error(
        error?.message ?? String(tr("project.settings.members.invite.failed")),
      );
      return false;
    } finally {
      setLoading(false);
    }
  };

  return { invite, loading };
};

export interface InviteMember {
  /**
   * Resolves `true` when the invitation was created, `false` when it was
   * refused or the email was blank. Either way the user has already been
   * told - the caller only has to decide what to do with its own form.
   */
  invite: (projectId: number, email: string) => Promise<boolean>;
  loading: boolean;
}
