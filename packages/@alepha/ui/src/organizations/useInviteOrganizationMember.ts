import type { OrganizationInvitationController } from "alepha/api/organizations";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import { useToast } from "../core/useToast.tsx";

export interface InviteOrganizationMember {
  invite: (
    organizationId: string,
    email: string,
    rank: string | undefined,
  ) => Promise<boolean | undefined>;
  loading: boolean;
  can: boolean;
}

export const useInviteOrganizationMember = (): InviteOrganizationMember => {
  const api = useClient<OrganizationInvitationController>();
  const toaster = useToast();
  const { tr } = useI18n();
  const action = useAction<
    [organizationId: string, email: string, rank: string | undefined],
    boolean
  >(
    {
      handler: async (organizationId, email, rank) => {
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
          body: { email: trimmed, ...(rank ? { rank } : {}) },
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
