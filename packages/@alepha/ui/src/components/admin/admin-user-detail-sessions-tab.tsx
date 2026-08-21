import * as React from "react";

void React;

import {
  AlephaTable,
  type TableFetcher,
} from "@alepha/ui/components/alepha-table/alepha-table";
import type { SessionResource } from "alepha/api/users";
import type { UseActionReturn } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { LogOut } from "lucide-react";

export interface AdminUserDetailSessionsTabProps {
  /**
   * Scopes the table's persisted column/sort state to this user.
   */
  userId: string;
  fetch: TableFetcher<SessionResource>;
  revokeSession: UseActionReturn<[SessionResource, () => void], void>;
  bulkRevokeSessions: UseActionReturn<
    [SessionResource[], { refresh: () => void; clearSelection: () => void }],
    void
  >;
}

/**
 * Sessions tab: active sessions for the user, revocable one at a time or in
 * bulk.
 */
export const AdminUserDetailSessionsTab = (
  props: AdminUserDetailSessionsTabProps,
) => {
  const { tr, l } = useI18n();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
      <AlephaTable<SessionResource>
        className="min-h-0 flex-1"
        persistenceKey={`admin.userDetail.${props.userId}.sessions`}
        fetch={props.fetch}
        bulkActions={[
          {
            label: tr("admin.userDetail.revokeSelected", {
              default: "Revoke selected",
            }),
            icon: LogOut,
            destructive: true,
            onClick: (items, ctx) => props.bulkRevokeSessions.run(items, ctx),
          },
        ]}
        columns={{
          ip: {
            label: tr("admin.userDetail.colIp", { default: "IP" }),
            cell: (s) => <code className="text-xs">{s.ip ?? "—"}</code>,
          },
          userAgent: {
            label: tr("admin.userDetail.colDevice", {
              default: "Device",
            }),
            cell: (s) => {
              const ua = s.userAgent;
              const text = ua
                ? [ua.browser, ua.os].filter(Boolean).join(" • ") || "—"
                : "—";
              return (
                <span className="text-muted-foreground line-clamp-1 text-xs">
                  {text}
                </span>
              );
            },
          },
          createdAt: {
            label: tr("admin.userDetail.colStarted", {
              default: "Started",
            }),
            sortable: true,
            cell: (s) => (
              <span className="text-muted-foreground text-xs">
                {String(l(s.createdAt, { date: "fromNow" }))}
              </span>
            ),
          },
        }}
        rowActions={(s) => [
          {
            label: tr("admin.userDetail.revoke", { default: "Revoke" }),
            icon: LogOut,
            destructive: true,
            onClick: (_s, ctx) => props.revokeSession.run(s, ctx.refresh),
          },
        ]}
      />
    </div>
  );
};
