import type {
  OrganizationInvitation,
  OrganizationRankResource,
} from "alepha/api/organizations";
import { useI18n } from "alepha/react/i18n";
import { Mail, MoreHorizontal } from "lucide-react";

import { Badge } from "../core/Badge.tsx";
import { Button } from "../core/Button.tsx";
import { Card, CardContent } from "../core/Card.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../core/DropdownMenu.tsx";
import TimeAgo from "../core/TimeAgo.tsx";
import { settingsCardEdge } from "../settings/settingsCardEdge.ts";
import { useRevokeOrganizationInvitation } from "./useRevokeOrganizationInvitation.ts";

export interface OrganizationPendingInvitationsProps {
  organizationId: string;
  invitations: OrganizationInvitation[];
  ranks: OrganizationRankResource[];
  onRevoked: () => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}

export const OrganizationPendingInvitations = (
  props: OrganizationPendingInvitationsProps,
) => {
  const revoke = useRevokeOrganizationInvitation();
  const { tr } = useI18n();

  const runRevoke = async (invitation: OrganizationInvitation) => {
    props.onBusyChange?.(true);
    try {
      const revoked = await revoke.revoke(
        props.organizationId,
        invitation.id,
        invitation.email,
      );
      if (revoked) await props.onRevoked();
    } finally {
      props.onBusyChange?.(false);
    }
  };

  return (
    <>
      {props.invitations.map((invitation) => {
        const rank = invitation.rank ?? "member";
        const rankName =
          props.ranks.find((item) => item.key === rank)?.name ?? rank;
        return (
          <Card
            key={invitation.id}
            className={`${settingsCardEdge} py-3 opacity-80`}
          >
            <CardContent className="flex items-center gap-4 px-3">
              <div className="bg-muted flex size-9 items-center justify-center rounded-full">
                <Mail className="size-4" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {invitation.email}
                  </span>
                  <Badge variant="secondary">{rankName}</Badge>
                </div>
                <span className="text-muted-foreground text-xs">
                  {tr("organizations.invitations.expires", {
                    default: "Expires",
                  })}{" "}
                  <TimeAgo value={invitation.expiresAt} />
                </span>
              </div>
              {revoke.can && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="minimal"
                        size="icon"
                        data-testid="invitation-actions"
                        disabled={revoke.loading}
                        aria-label={tr("organizations.invitations.actions", {
                          default: "Invitation actions",
                        })}
                      />
                    }
                  >
                    <MoreHorizontal className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      variant="destructive"
                      data-testid="revoke-invitation"
                      onClick={() => void runRevoke(invitation)}
                    >
                      {tr("organizations.invitations.revoke", {
                        default: "Revoke",
                      })}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </CardContent>
          </Card>
        );
      })}
    </>
  );
};
