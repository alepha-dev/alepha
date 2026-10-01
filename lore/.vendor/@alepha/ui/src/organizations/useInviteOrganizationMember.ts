import type { OrganizationInvitationController } from "alepha/api/organizations";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import { useToast } from "../core/useToast.tsx";

export interface InviteOrganizationMember {
  /**
   * Send an invitation.
   *
   * `metadata` is the application's own, stored on the invitation row and
   * handed back on `organization:invitation:accepted`. The framework never
   * reads it: it is how an application carries a fact of its own alongside the
   * rank - Alepha Club puts the club ROLES it is inviting somebody as there,
   * because a rank says what you may do as staff and a role says whether you
   * are a coach, and the framework has no business knowing that club has
   * coaches.
   */
  invite: (
    organizationId: string,
    email: string,
    rank: string | undefined,
    metadata?: Record<string, unknown>,
  ) => Promise<boolean | undefined>;
  loading: boolean;
  can: boolean;
}

export const useInviteOrganizationMember = (): InviteOrganizationMember => {
  const api = useClient<OrganizationInvitationController>();
  const toaster = useToast();
  const { tr } = useI18n();
  const action = useAction<
    [
      organizationId: string,
      email: string,
      rank: string | undefined,
      metadata?: Record<string, unknown>,
    ],
    boolean
  >(
    {
      handler: async (organizationId, email, rank, passed) => {
        /**
         * ⚠️ `useAction` appends `{ signal }` as the LAST argument to the
         * handler, so a caller passing three arguments lands its abort signal
         * in this fourth parameter. Reading it as metadata put an
         * `AbortSignal` on the invitation row.
         *
         * Hence the shape check rather than a plain `?? undefined`: an
         * application's metadata is its own object, and the framework's is the
         * one carrying `signal`.
         */
        const metadata = passed && !("signal" in passed) ? passed : undefined;
        const trimmed = email.trim();
        if (!trimmed) {
          toaster.error(
            tr("organizations.invitations.emailRequired", {
              default: "Enter an email address",
            }),
          );
          return false;
        }
        await api.createOrganizationInvitation({
          params: { organizationId },
          body: {
            email: trimmed,
            ...(rank ? { rank } : {}),
            ...(metadata ? { metadata } : {}),
          },
        });
        toaster.success(
          tr("organizations.invitations.sent", {
            default: "Invitation sent to $1",
            args: [trimmed],
          }),
        );
        return true;
      },
    },
    [api, toaster, tr],
  );

  return {
    invite: action.run,
    loading: action.loading,
    can: api.createOrganizationInvitation.can(),
  };
};
