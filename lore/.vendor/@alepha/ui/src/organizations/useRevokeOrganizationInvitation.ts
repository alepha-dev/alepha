import type { OrganizationInvitationController } from "alepha/api/organizations";
import { type RunResult, useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useCallback } from "react";

import { useDialog } from "../core/useDialog.tsx";
import { useToast } from "../core/useToast.tsx";

export interface RevokeOrganizationInvitation {
  /**
   * Ask, then revoke. Resolves `{ ok: true }` once revoked,
   * `{ ok: false, reason: "cancelled" }` when the user declined the confirm,
   * and `useAction`'s other results otherwise.
   */
  revoke: (
    organizationId: string,
    invitationId: string,
    email: string,
  ) => Promise<RunResult<void>>;
  loading: boolean;
  can: boolean;
}

export const useRevokeOrganizationInvitation =
  (): RevokeOrganizationInvitation => {
    const api = useClient<OrganizationInvitationController>();
    const toaster = useToast();
    const dialog = useDialog();
    const { tr } = useI18n();
    const action = useAction<
      [organizationId: string, invitationId: string, email: string],
      boolean
    >(
      {
        handler: async (_ctx, organizationId, invitationId, email) => {
          const confirmed = await dialog.confirm({
            title: tr("organizations.invitations.revokeTitle", {
              default: "Revoke the invitation for $1?",
              args: [email],
            }),
            description: tr("organizations.invitations.revokeDescription", {
              default: "The invitation link will stop working immediately.",
            }),
            confirmLabel: tr("organizations.invitations.revoke", {
              default: "Revoke",
            }),
            cancelLabel: tr("organizations.members.cancel", {
              default: "Cancel",
            }),
            destructive: true,
          });
          if (!confirmed) return false;
          await api.revokeOrganizationInvitation({
            params: { organizationId, invitationId },
          });
          toaster.success(
            tr("organizations.invitations.revoked", {
              default: "Invitation revoked",
            }),
          );
          return true;
        },
      },
      [api, dialog, toaster, tr],
    );

    const revoke = useCallback(
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
      revoke,
      loading: action.loading,
      can: api.revokeOrganizationInvitation.can(),
    };
  };
