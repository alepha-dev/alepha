import * as React from "react";

void React;

import {
  AdminDetailAside,
  type AdminDetailAsideRow,
} from "@alepha/ui/components/admin/admin-detail-aside";
import { Badge } from "@alepha/ui/components/ui/badge";
import type { UserResource } from "alepha/api/users";
import { useI18n } from "alepha/react/i18n";
import { ShieldCheck } from "lucide-react";

export interface AdminUserDetailIdentityAsideProps {
  user: UserResource;
}

/**
 * Identity sheet shown alongside the user detail tabs.
 *
 * Everything here is *which* facts a user has and how they read; the chrome
 * around them belongs to {@link AdminDetailAside}. Only fields with a value are
 * listed; ID and Status always show. Display order is ID → username → email →
 * (phone) → status → name → roles → dates.
 */
export const AdminUserDetailIdentityAside = (
  props: AdminUserDetailIdentityAsideProps,
) => {
  const { tr, l } = useI18n();
  const user = props.user;

  const displayName =
    user.email ||
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.username ||
    user.id.slice(0, 8);
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");

  const rows: AdminDetailAsideRow[] = [];

  rows.push({
    label: String(tr("admin.userDetail.id", { default: "ID" })),
    copy: user.id,
  });
  if (user.username) {
    rows.push({
      label: String(tr("admin.userDetail.username", { default: "Username" })),
      value: (
        <span className="block truncate" title={user.username}>
          @{user.username}
        </span>
      ),
    });
  }
  if (user.email) {
    rows.push({
      label: String(tr("admin.userDetail.email", { default: "Email" })),
      value: (
        <a
          href={`mailto:${user.email}`}
          className="text-primary block truncate hover:underline"
          title={user.email}
        >
          {user.email}
        </a>
      ),
    });
  }
  if (user.phoneNumber) {
    rows.push({
      label: String(tr("admin.userDetail.phone", { default: "Phone" })),
      value: (
        <a
          href={`tel:${user.phoneNumber}`}
          className="text-primary block truncate font-mono hover:underline"
        >
          {user.phoneNumber}
        </a>
      ),
    });
  }
  rows.push({
    label: String(tr("admin.userDetail.fieldStatus", { default: "Status" })),
    value: (
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant={user.enabled ? "default" : "destructive"}>
          {user.enabled
            ? tr("admin.userDetail.active", { default: "Active" })
            : tr("admin.userDetail.disabledBadge", { default: "Disabled" })}
        </Badge>
        {user.emailVerified && (
          <Badge variant="outline" className="gap-1">
            <ShieldCheck className="size-3" />
            {tr("admin.userDetail.verified", { default: "Verified" })}
          </Badge>
        )}
      </div>
    ),
  });
  rows.push({
    label: String(tr("admin.userDetail.name", { default: "Name" })),
    value: (
      <span className="block truncate">
        {fullName || <span className="text-muted-foreground">—</span>}
      </span>
    ),
  });
  if (user.roles?.length) {
    rows.push({
      label: String(tr("admin.userDetail.roles", { default: "Roles" })),
      value: <span className="block">{user.roles.join(", ")}</span>,
    });
  }
  rows.push({
    label: String(tr("admin.userDetail.lastLogin", { default: "Last login" })),
    value: (
      <span className="block">
        {user.lastLoginAt
          ? String(l(user.lastLoginAt, { date: "lll" }))
          : tr("admin.userDetail.never", { default: "Never" })}
      </span>
    ),
  });
  rows.push({
    label: String(tr("admin.userDetail.created", { default: "Created" })),
    value: (
      <span className="block">
        {String(l(user.createdAt, { date: "lll" }))}
      </span>
    ),
  });

  return (
    <AdminDetailAside
      title={String(displayName)}
      image={user.picture}
      fallback={user.email || user.username || user.firstName || "?"}
      rows={rows}
    />
  );
};
