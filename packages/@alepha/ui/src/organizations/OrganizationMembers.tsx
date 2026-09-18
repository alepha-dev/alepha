import type {
  MemberController,
  OrganizationMemberResource,
  OrganizationRankController,
  OrganizationRankResource,
} from "alepha/api/organizations";
import { useAction, useClient, useQuery } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { LogOut, MoreHorizontal, Trash2, Users } from "lucide-react";
import { useState } from "react";

import { Badge } from "../core/Badge.tsx";
import { Button } from "../core/Button.tsx";
import { Card, CardContent } from "../core/Card.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../core/DropdownMenu.tsx";
import { useDialog } from "../core/useDialog.tsx";
import { useToast } from "../core/useToast.tsx";
import { settingsCardEdge } from "../settings/settingsCardEdge.ts";
import { OrganizationMemberIdentity } from "./OrganizationMemberIdentity.tsx";
import { OrganizationMemberRankPicker } from "./OrganizationMemberRankPicker.tsx";

export interface OrganizationMembersProps {
  organizationId: string;
  can: (permission: string) => boolean;
  onLeft?: () => void | Promise<void>;
}

export const OrganizationMembers = (props: OrganizationMembersProps) => {
  const membersApi = useClient<MemberController>();
  const ranksApi = useClient<OrganizationRankController>();
  const auth = useAuth();
  const dialog = useDialog();
  const toaster = useToast();
  const { tr } = useI18n();
  const [rankBusy, setRankBusy] = useState(false);
  const canManage = props.can("member:manage");

  const membersQuery = useQuery(
    {
      key: ["organization-members", props.organizationId],
      handler: () =>
        membersApi.getOrganizationMembers({
          params: { organizationId: props.organizationId },
        }),
    },
    [membersApi, props.organizationId],
  );
  const ranksQuery = useQuery(
    {
      key: ["organization-ranks", props.organizationId],
      enabled: canManage,
      handler: () =>
        ranksApi.getOrganizationRanks({
          params: { organizationId: props.organizationId },
        }),
      onError: () => {},
    },
    [ranksApi, props.organizationId, canManage],
  );

  const remove = useAction<[OrganizationMemberResource], void>(
    {
      handler: async (member) => {
        const name =
          member.user.username ||
          member.user.email ||
          member.user.id.slice(0, 8);
        const confirmed = await dialog.confirm({
          title: tr("organizations.members.removeTitle", {
            default: "Remove $1?",
            args: [name],
          }),
          description: tr("organizations.members.removeDescription", {
            default:
              "This person will immediately lose access to the organization.",
          }),
          confirmLabel: tr("organizations.members.remove", {
            default: "Remove",
          }),
          cancelLabel: tr("organizations.members.cancel", {
            default: "Cancel",
          }),
          destructive: true,
        });
        if (!confirmed) return;
        await membersApi.removeOrganizationMember({
          params: {
            organizationId: props.organizationId,
            userId: member.userId,
          },
        });
        await membersQuery.refetch();
        toaster.success(
          tr("organizations.members.removed", { default: "Member removed" }),
        );
      },
    },
    [dialog, membersApi, membersQuery, props.organizationId, toaster, tr],
  );

  const leave = useAction<[], void>(
    {
      handler: async () => {
        const confirmed = await dialog.confirm({
          title: tr("organizations.members.leaveTitle", {
            default: "Leave this organization?",
          }),
          description: tr("organizations.members.leaveDescription", {
            default: "You will immediately lose access to this organization.",
          }),
          confirmLabel: tr("organizations.members.leave", { default: "Leave" }),
          cancelLabel: tr("organizations.members.cancel", {
            default: "Cancel",
          }),
          destructive: true,
        });
        if (!confirmed) return;
        await membersApi.leaveOrganization({
          params: { organizationId: props.organizationId },
        });
        toaster.success(
          tr("organizations.members.left", { default: "Organization left" }),
        );
        await props.onLeft?.();
      },
    },
    [dialog, membersApi, props.organizationId, props.onLeft, toaster, tr],
  );

  const members = membersQuery.data ?? [];
  const ranks = (ranksQuery.data?.items ?? []) as OrganizationRankResource[];
  const mine = members.find((member) => member.userId === auth.user?.id);
  const busy =
    membersQuery.loading || remove.loading || leave.loading || rankBusy;

  return (
    <section className="relative flex flex-col gap-3" aria-busy={busy}>
      {busy && (
        <div
          className="bg-background/60 absolute inset-0 z-10 cursor-wait rounded-lg backdrop-blur-[1px]"
          data-testid="organization-members-busy"
        />
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users className="size-4" />
          <span className="text-sm font-medium">
            {tr("organizations.members.title", { default: "Members" })}
          </span>
          <Badge variant="secondary">{members.length}</Badge>
        </div>
        {mine && mine.rank !== "owner" && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void leave.run()}
          >
            <LogOut className="size-3.5" />
            {tr("organizations.members.leave", { default: "Leave" })}
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {members.map((member) => (
          <Card key={member.id} className={`${settingsCardEdge} py-3`}>
            <CardContent className="flex items-center gap-4 px-3">
              <OrganizationMemberIdentity
                member={member}
                rankName={ranks.find((rank) => rank.key === member.rank)?.name}
              />
              <OrganizationMemberRankPicker
                organizationId={props.organizationId}
                userId={member.userId}
                rank={member.rank}
                ranks={ranks}
                self={member.userId === auth.user?.id}
                canAssign={canManage}
                onBusyChange={setRankBusy}
                onAssigned={async () => {
                  await membersQuery.refetch();
                }}
              />
              {canManage && member.rank !== "owner" && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        data-testid="member-actions"
                        disabled={busy}
                        aria-label={tr("organizations.members.actions", {
                          default: "Member actions",
                        })}
                      />
                    }
                  >
                    <MoreHorizontal className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      variant="destructive"
                      data-testid="remove-member"
                      onClick={() => void remove.run(member)}
                    >
                      <Trash2 className="size-4" />
                      {tr("organizations.members.remove", {
                        default: "Remove",
                      })}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
};
