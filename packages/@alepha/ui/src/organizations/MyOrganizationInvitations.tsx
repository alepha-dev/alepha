import type { OrganizationInvitationController } from "alepha/api/organizations";
import { useAction, useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Check, Mail, X } from "lucide-react";

import { Badge } from "../core/Badge.tsx";
import { Button } from "../core/Button.tsx";
import { useToast } from "../core/useToast.tsx";
import { SettingsHeading } from "../settings/SettingsHeading.tsx";

export interface MyOrganizationInvitationsProps {
  onAccepted?: (organizationId: string) => void | Promise<void>;
}

export const MyOrganizationInvitations = (
  props: MyOrganizationInvitationsProps,
) => {
  const api = useClient<OrganizationInvitationController>();
  const toaster = useToast();
  const { tr } = useI18n();
  const invitations = useQuery(
    {
      key: ["my-organization-invitations"],
      handler: () => api.getMyOrganizationInvitations(),
    },
    [api],
  );
  const accept = useAction<[invitationId: string], void>(
    {
      handler: async (invitationId) => {
        const accepted = await api.acceptOrganizationInvitation({
          params: { invitationId },
        });
        await invitations.refetch();
        toaster.success(
          tr("organizations.invitations.accepted", {
            default: "Invitation accepted",
          }),
        );
        await props.onAccepted?.(accepted.organizationId);
      },
    },
    [api, invitations, props.onAccepted, toaster, tr],
  );
  const decline = useAction<[invitationId: string], void>(
    {
      handler: async (invitationId) => {
        await api.declineOrganizationInvitation({
          params: { invitationId },
        });
        await invitations.refetch();
        toaster.show(
          tr("organizations.invitations.declined", {
            default: "Invitation declined",
          }),
          "warning",
        );
      },
    },
    [api, invitations, toaster, tr],
  );
  const items = invitations.data ?? [];
  const busy = invitations.loading || accept.loading || decline.loading;

  return (
    <div className="flex w-full flex-col gap-2" aria-busy={busy}>
      <SettingsHeading
        title={tr("organizations.invitations.myTitle", {
          default: "Invitations",
        })}
        description={tr("organizations.invitations.myDescription", {
          default: "Organizations that invited you to join.",
        })}
      />
      {items.length === 0 ? (
        <div className="border-border bg-card flex flex-col items-center gap-2 rounded-md border p-6 text-center">
          <Mail className="text-muted-foreground size-5" />
          <span className="text-sm">
            {tr("organizations.invitations.empty", {
              default: "You have no pending invitations.",
            })}
          </span>
        </div>
      ) : (
        <div className="border-border bg-card flex flex-col gap-2 rounded-md border p-2">
          {items.map((invitation) => (
            <div
              key={invitation.id}
              className="border-border bg-muted/40 flex items-center gap-3 rounded-md border p-3 shadow-sm"
            >
              <div className="bg-background flex size-10 items-center justify-center rounded-md">
                <Mail className="size-5" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {invitation.organizationName ?? invitation.organizationId}
                  </span>
                  <Badge variant="secondary">
                    {tr("organizations.invitations.pending", {
                      default: "Pending",
                    })}
                  </Badge>
                </div>
                <span className="text-muted-foreground truncate text-xs">
                  {invitation.email}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void decline.run(invitation.id)}
                >
                  <X className="size-3.5" />
                  {tr("organizations.invitations.decline", {
                    default: "Decline",
                  })}
                </Button>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void accept.run(invitation.id)}
                >
                  <Check className="size-3.5" />
                  {tr("organizations.invitations.accept", {
                    default: "Accept",
                  })}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
