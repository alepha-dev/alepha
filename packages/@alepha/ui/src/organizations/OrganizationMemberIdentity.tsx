import type { OrganizationMemberResource } from "alepha/api/organizations";

import { Badge } from "../core/Badge.tsx";
import { UserAvatar } from "../core/UserAvatar.tsx";

export interface OrganizationMemberIdentityProps {
  member: OrganizationMemberResource;
  rankName?: string;
}

export const OrganizationMemberIdentity = (
  props: OrganizationMemberIdentityProps,
) => {
  const user = props.member.user;
  const name =
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.username ||
    user.email ||
    user.id.slice(0, 8);
  const initial = name.trim().charAt(0).toUpperCase();

  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-3"
      data-testid="member-identity"
    >
      <UserAvatar
        fileId={user.picture}
        alt={name}
        public
        fallback={initial}
        className="size-9"
      />
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{name}</span>
          <Badge variant="secondary">
            {props.rankName ??
              props.member.rankName ??
              props.member.rank ??
              "member"}
          </Badge>
        </div>
        {user.email && name !== user.email && (
          <span className="text-muted-foreground truncate text-xs">
            {user.email}
          </span>
        )}
      </div>
    </div>
  );
};
