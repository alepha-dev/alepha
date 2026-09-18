import { useToast } from "@alepha/ui";
import type { OrganizationInvitationController } from "alepha/api/organizations";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

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
 *
 * The verb is a `useAction` run (#E59): a refused invitation is not caught
 * here, it is toasted by the root `ActionErrorToaster` with the server's own
 * message, and `invite` resolves `undefined` for it.
 */
export const useInviteMember = (): InviteMember => {
  const invitationApi = useClient<OrganizationInvitationController>();
  const toaster = useToast();
  const { tr } = useI18n<I18n, "en">();
  const action = useAction<
    [organizationId: string, email: string, rank: string | undefined],
    boolean
  >(
    {
      handler: async (organizationId, email, rank) => {
        const trimmed = email.trim();
        if (!trimmed) {
          toaster.error(tr("project.settings.members.invite.emailRequired"));
          return false;
        }
        await invitationApi.createOrganizationInvitation({
          params: { organizationId },
          body: {
            email: trimmed,
            ...(rank ? { rank } : {}),
          },
        });
        toaster.success(
          tr("project.settings.members.invite.sent", { args: [trimmed] }),
        );
        return true;
      },
    },
    [invitationApi, toaster, tr],
  );

  return {
    invite: action.run,
    loading: action.loading,
    can: invitationApi.createOrganizationInvitation.can(),
  };
};

export interface InviteMember {
  /**
   * Resolves `true` when the invitation was created, `false` when the email
   * was blank, and `undefined` when the server refused it. Every time the
   * user has already been told - the caller only has to decide what to do
   * with its own form.
   */
  invite: (
    organizationId: string,
    email: string,
    /**
     * The rank they land on. `undefined` means `member`, which is what every
     * invitation sent before epic #E39 resolves to.
     *
     * ⚠️ Required, even when `undefined`: `useAction` appends `{ signal }` as
     * the last argument, so an optional `rank` left out would receive it and
     * send `roles: [{ signal }]`.
     */
    rank: string | undefined,
  ) => Promise<boolean | undefined>;
  loading: boolean;
  /**
   * Whether this reader's rank may invite at all. Returned beside the verb
   * rather than asked separately by each caller, so the two entry points
   * cannot disagree about who is offered the control - which is the same
   * duplication this hook exists to end.
   */
  can: boolean;
}
