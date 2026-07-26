import * as React from "react";

void React;

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alepha/ui/components/ui/avatar";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import type { UserResource } from "alepha/api/users";
import { useI18n } from "alepha/react/i18n";
import { Check, Copy, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface AdminUserDetailIdentityAsideProps {
  user: UserResource;
}

/**
 * Identity sheet shown alongside the user detail tabs.
 *
 * Admin-style: a dense label/value list rather than a marketing hero. Only
 * fields with a value are listed; ID and Status always show. Display order is
 * ID → username → email → (phone) → status → name → roles → dates.
 */
export const AdminUserDetailIdentityAside = (
  props: AdminUserDetailIdentityAsideProps,
) => {
  const { tr, l } = useI18n();
  const user = props.user;

  const [copiedId, setCopiedId] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // Clear the copy-feedback reset timer on unmount.
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(user.id);
      setCopiedId(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedId(false), 1_500);
    } catch {
      // clipboard may be unavailable (insecure context); ignore
    }
  };

  const initial = (user.email || user.username || user.firstName || "?")
    .charAt(0)
    .toUpperCase();
  const displayName =
    user.email ||
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.username ||
    user.id.slice(0, 8);
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");

  const rows: Array<{ label: string; value: React.ReactNode }> = [];

  rows.push({
    label: String(tr("admin.userDetail.id", { default: "ID" })),
    value: (
      <div className="flex items-center gap-1">
        <code
          className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs"
          title={user.id}
        >
          {user.id}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={copyId}
          aria-label={String(
            tr("admin.userDetail.copyId", { default: "Copy ID" }),
          )}
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          {copiedId ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </Button>
      </div>
    ),
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
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Avatar className="size-10 rounded-md after:rounded-md">
          {user.picture && (
            <AvatarImage
              src={user.picture}
              alt={String(displayName)}
              className="rounded-md"
            />
          )}
          <AvatarFallback className="rounded-md">{initial}</AvatarFallback>
        </Avatar>
        <span
          className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight"
          title={String(displayName)}
        >
          {displayName}
        </span>
      </div>
      <dl className="flex flex-col gap-3 border-t pt-4 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
              {row.label}
            </dt>
            <dd className="min-w-0">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
};
