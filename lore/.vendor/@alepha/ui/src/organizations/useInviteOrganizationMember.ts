import type { OrganizationInvitationController } from "alepha/api/organizations";
import { type RunResult, useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useCallback } from "react";

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
   *
   * Resolves `{ ok: true }` once sent, `{ ok: false, reason: "cancelled" }`
   * when a local check refused it (an empty address, toasted here), and
   * `useAction`'s other results otherwise.
   */
  invite: (
    organizationId: string,
    email: string,
    rank: string | undefined,
    metadata?: Record<string, unknown>,
  ) => Promise<RunResult<void>>;
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
      handler: async (_ctx, organizationId, email, rank, metadata) => {
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

  const invite = useCallback(
    async (
      ...args: Parameters<typeof action.run>
    ): Promise<RunResult<void>> => {
      const result = await action.run(...args);
      if (!result.ok) return result;
      return result.value
        ? { ok: true, value: undefined }
        : { ok: false, reason: "cancelled" };
    },
    [action.run],
  );

  return {
    invite,
    loading: action.loading,
    can: api.createOrganizationInvitation.can(),
  };
};
