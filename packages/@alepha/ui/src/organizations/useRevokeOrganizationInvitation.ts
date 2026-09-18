import type { OrganizationInvitationController } from "alepha/api/organizations";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import { useDialog } from "../core/useDialog.tsx";
import { useToast } from "../core/useToast.tsx";

export interface RevokeOrganizationInvitation {
  revoke: (
    organizationId: string,
    invitationId: string,
    email: string,
  ) => Promise<boolean | undefined>;
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
        handler: async (organizationId, invitationId, email) => {
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

    return {
      revoke: action.run,
      loading: action.loading,
      can: api.revokeOrganizationInvitation.can(),
    };
  };
