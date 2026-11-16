import * as React from "react";

void React;

import type { UserResource } from "alepha/api/users";
import { useI18n } from "alepha/react/i18n";
import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "../core/Badge.tsx";
import { textLinkUnderlineClassName } from "../core/TextLink.tsx";
import { cn } from "../core/utils.ts";
import { DetailAside, type DetailAsideRow } from "../shell/DetailAside.tsx";
import { AdminUsersStatusBadge } from "./AdminUsersStatusBadge.tsx";

export interface AdminUserDetailIdentityAsideProps {
  user: UserResource;
  /**
   * Wraps the header avatar, as `DetailAside`'s `renderAvatar` (#Q3663): the
   * page passes the avatar's edit control.
   */
  renderAvatar?: (avatar: ReactNode) => ReactNode;
}

/**
 * Identity sheet shown alongside the user detail tabs.
 *
 * Everything here is *which* facts a user has and how they read; the chrome
 * around them belongs to {@link DetailAside}. Only fields with a value are
 * listed; ID and Status always show. Display order is ID → username → email →
 * (phone) → status → name → roles → dates.
 */
export const AdminUserDetailIdentityAside = (
  props: AdminUserDetailIdentityAsideProps,
) => {
  const { tr, l } = useI18n();
  const user = props.user;

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");
  // The full name, else `@username` (#Q3663), never the email: it is a row
  // of the list right below. With neither, the avatar stands alone.
  const title = fullName || (user.username ? `@${user.username}` : undefined);

  const rows: DetailAsideRow[] = [];

  rows.push({
    label: tr("admin.userDetail.id", { default: "ID" }),
    copy: user.id,
  });
  if (user.username) {
    rows.push({
      label: tr("admin.userDetail.username", { default: "Username" }),
      value: (
        <span className="block truncate" title={user.username}>
          @{user.username}
        </span>
      ),
    });
  }
  if (user.email) {
    rows.push({
      label: tr("admin.userDetail.email", { default: "Email" }),
      value: (
        <a
          href={`mailto:${user.email}`}
          className={cn(
            textLinkUnderlineClassName,
            "hover:text-foreground block truncate",
          )}
          title={user.email}
        >
          {user.email}
        </a>
      ),
    });
  }
  if (user.phoneNumber) {
    rows.push({
      label: tr("admin.userDetail.phone", { default: "Phone" }),
      value: (
        <a
          href={`tel:${user.phoneNumber}`}
          className={cn(
            textLinkUnderlineClassName,
            "hover:text-foreground block truncate font-mono",
          )}
        >
          {user.phoneNumber}
        </a>
      ),
    });
  }
  rows.push({
    label: tr("admin.userDetail.fieldStatus", { default: "Status" }),
    value: (
      <div className="flex flex-wrap items-center gap-1">
        {/* The list's own chip, so the two pages cannot show one status two
            ways. Verified sits beside it in the same design: a fact about
            the address rather than a status, so an `info` tint. */}
        <AdminUsersStatusBadge enabled={user.enabled} />
        {user.emailVerified && (
          <Badge variant="tint" tone="info">
            <ShieldCheck className="size-3" />
            {tr("admin.userDetail.verified", { default: "Verified" })}
          </Badge>
        )}
      </div>
    ),
  });
  rows.push({
    label: tr("admin.userDetail.name", { default: "Name" }),
    value: (
      <span className="block truncate">
        {fullName || <span className="text-muted-foreground">—</span>}
      </span>
    ),
  });
  if (user.roles?.length) {
    rows.push({
      label: tr("admin.userDetail.roles", { default: "Roles" }),
      value: <span className="block">{user.roles.join(", ")}</span>,
    });
  }
  rows.push({
    label: tr("admin.userDetail.lastLogin", { default: "Last login" }),
    value: (
      <span className="block">
        {user.lastLoginAt
          ? l(user.lastLoginAt, { date: "lll" })
          : tr("admin.userDetail.never", { default: "Never" })}
      </span>
    ),
  });
  rows.push({
    label: tr("admin.userDetail.created", { default: "Created" }),
    value: <span className="block">{l(user.createdAt, { date: "lll" })}</span>,
  });

  return (
    <DetailAside
      title={title}
      renderAvatar={props.renderAvatar}
      imageFileId={user.picture}
      fallback={user.email || user.username || user.firstName || "?"}
      rows={rows}
    />
  );
};
