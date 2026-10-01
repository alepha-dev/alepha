import type { OrganizationInvitationController } from "alepha/api/organizations";
import { useAction, useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Building2, Check, Mail, X } from "lucide-react";

import { Badge } from "../core/Badge.tsx";
import { Button } from "../core/Button.tsx";
import TimeAgo from "../core/TimeAgo.tsx";
import { useToast } from "../core/useToast.tsx";
import { DataTable } from "../table/DataTable.tsx";

export interface MyOrganizationInvitationsProps {
  load?: () => Promise<MyOrganizationInvitationItem[]>;
  accept?: (invitationId: string) => Promise<string>;
  decline?: (invitationId: string) => Promise<void>;
  onAccepted?: (organizationId: string) => void | Promise<void>;
  /**
   * Extra classes merged onto the table, typically `min-h-0 flex-1` when
   * the host frame gives it the height to fill.
   */
  className?: string;
}

export interface MyOrganizationInvitationItem {
  id: string;
  organizationId: string;
  organizationName?: string;
  email: string;
  /**
   * The rank the invitation grants on acceptance, when it names one.
   */
  rank?: string;
  /**
   * Who sent it, by name. The framework's own list carries only the
   * inviter's id, so the column shows a placeholder unless an application's
   * `load` resolves the name.
   */
  inviterName?: string;
  /**
   * When the invitation was sent.
   */
  createdAt?: string;
  /**
   * When it stops being acceptable.
   */
  expiresAt?: string;
}

/**
 * The invitations waiting for the signed-in user, as a `DataTable` with
 * Accept and Decline as buttons on each row.
 *
 * The list is unpaginated (`getMyOrganizationInvitations`, or the caller's
 * `load`), so the table is handed the array and pages it in memory. Both
 * verbs re-read the list, and every row's buttons are disabled while one
 * runs.
 *
 * It does not own the page frame: an account area wraps it in
 * `AccountPage variant="table"` (this module must not import `account`),
 * and passes `className="min-h-0 flex-1"` so the table fills it.
 */
export const MyOrganizationInvitations = (
  props: MyOrganizationInvitationsProps,
) => {
  const api = useClient<OrganizationInvitationController>();
  const toaster = useToast();
  const { tr } = useI18n();
  const invitations = useQuery(
    {
      key: ["my-organization-invitations"],
      handler: () =>
        props.load?.() ??
        (api.getMyOrganizationInvitations() as Promise<
          MyOrganizationInvitationItem[]
        >),
    },
    [api, props.load],
  );
  const accept = useAction<[invitationId: string], void>(
    {
      handler: async (invitationId) => {
        const organizationId = props.accept
          ? await props.accept(invitationId)
          : (
              await api.acceptOrganizationInvitation({
                params: { invitationId },
              })
            ).organizationId;
        await invitations.refetch();
        toaster.success(
          tr("organizations.invitations.accepted", {
            default: "Invitation accepted",
          }),
        );
        await props.onAccepted?.(organizationId);
      },
    },
    [api, invitations, props.accept, props.onAccepted, toaster, tr],
  );
  const decline = useAction<[invitationId: string], void>(
    {
      handler: async (invitationId) => {
        if (props.decline) {
          await props.decline(invitationId);
        } else {
          await api.declineOrganizationInvitation({
            params: { invitationId },
          });
        }
        await invitations.refetch();
        toaster.show(
          tr("organizations.invitations.declined", {
            default: "Invitation declined",
          }),
          "warning",
        );
      },
    },
    [api, invitations, props.decline, toaster, tr],
  );
  const items = invitations.data ?? [];
  const busy = invitations.loading || accept.loading || decline.loading;

  return (
    <DataTable<MyOrganizationInvitationItem>
      className={props.className}
      data={items}
      rowKey={(invitation) => invitation.id}
      emptyState={{
        icon: Mail,
        title: tr("organizations.invitations.empty", {
          default: "You have no pending invitations.",
        }),
        description: tr("organizations.invitations.myDescription", {
          default: "Organizations that invited you to join.",
        }),
      }}
      columns={{
        organizationName: {
          label: tr("organizations.invitations.colOrganization", {
            default: "Organization",
          }),
          sortable: true,
          sortValue: (invitation) =>
            invitation.organizationName ?? invitation.organizationId,
          cell: (invitation) => (
            <span
              className="flex items-center gap-2"
              data-testid="my-invitation-organization"
            >
              <Building2 className="text-muted-foreground size-4 shrink-0" />
              <span className="truncate font-medium">
                {invitation.organizationName ?? invitation.organizationId}
              </span>
              <Badge variant="secondary">
                {tr("organizations.invitations.pending", {
                  default: "Pending",
                })}
              </Badge>
            </span>
          ),
        },
        rank: {
          label: tr("organizations.invitations.colRank", { default: "Rank" }),
          cell: (invitation) =>
            invitation.rank ? (
              <Badge variant="outline">{invitation.rank}</Badge>
            ) : (
              <span className="text-muted-foreground text-xs">-</span>
            ),
        },
        inviterName: {
          label: tr("organizations.invitations.colInvitedBy", {
            default: "Invited by",
          }),
          cell: (invitation) =>
            invitation.inviterName ? (
              <span className="truncate text-sm">{invitation.inviterName}</span>
            ) : (
              <span className="text-muted-foreground text-xs">-</span>
            ),
        },
        email: {
          label: tr("organizations.invitations.colEmail", {
            default: "Sent to",
          }),
          cell: (invitation) => (
            <span className="text-muted-foreground truncate text-xs">
              {invitation.email}
            </span>
          ),
        },
        createdAt: {
          label: tr("organizations.invitations.colInvitedAt", {
            default: "Invited",
          }),
          sortable: true,
          cell: (invitation) =>
            invitation.createdAt ? (
              <TimeAgo
                value={invitation.createdAt}
                className="text-muted-foreground text-xs"
              />
            ) : (
              <span className="text-muted-foreground text-xs">-</span>
            ),
        },
        expiresAt: {
          label: tr("organizations.invitations.colExpires", {
            default: "Expires",
          }),
          sortable: true,
          cell: (invitation) =>
            invitation.expiresAt ? (
              <TimeAgo
                value={invitation.expiresAt}
                className="text-muted-foreground text-xs"
              />
            ) : (
              <span className="text-muted-foreground text-xs">-</span>
            ),
        },
        /*
          Accept and Decline are the page's whole purpose, so they sit in the
          row as buttons rather than behind its "…" menu: one click, and
          visible without knowing where to look.
        */
        actions: {
          label: tr("organizations.invitations.actions", {
            default: "Invitation actions",
          }),
          align: "right",
          cell: (invitation) => (
            <div className="flex justify-end gap-2">
              <Button
                variant="outlined"
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
          ),
        },
      }}
    />
  );
};
