import * as React from "react";

void React;

import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Badge } from "@alepha/ui/components/ui/badge";
import type { AuditEntity } from "alepha/api/audits";
import { useI18n } from "alepha/react/i18n";

export interface AdminUserDetailAuditsTabProps {
  /**
   * Scopes the table's persisted column/sort state to this user.
   */
  userId: string;
  fetch: React.ComponentProps<typeof AlephaTable<AuditEntity>>["fetch"];
}

/**
 * Audit tab: read-only trail of actions recorded against the user.
 */
export const AdminUserDetailAuditsTab = (
  props: AdminUserDetailAuditsTabProps,
) => {
  const { tr, l } = useI18n();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
      <AlephaTable<AuditEntity>
        className="min-h-0 flex-1"
        persistenceKey={`admin.userDetail.${props.userId}.audits`}
        fetch={props.fetch}
        columns={{
          createdAt: {
            label: tr("admin.userDetail.colWhen", {
              default: "When",
            }),
            sortable: true,
            cell: (a) => (
              <span className="text-muted-foreground text-xs">
                {String(l(a.createdAt, { date: "fromNow" }))}
              </span>
            ),
          },
          action: {
            label: tr("admin.userDetail.colAction", {
              default: "Action",
            }),
            cell: (a) => (
              <code className="text-xs font-medium">{a.action}</code>
            ),
          },
          resource: {
            label: tr("admin.userDetail.colResource", {
              default: "Resource",
            }),
            cell: (a) => (
              <span className="font-mono text-xs">
                {a.resourceType
                  ? `${a.resourceType}:${a.resourceId ?? "—"}`
                  : "—"}
              </span>
            ),
          },
          status: {
            label: tr("admin.userDetail.colAuditStatus", {
              default: "Status",
            }),
            cell: (a) => (
              <Badge variant={a.success ? "default" : "destructive"}>
                {a.success
                  ? tr("admin.userDetail.ok", { default: "OK" })
                  : tr("admin.userDetail.failed", {
                      default: "Failed",
                    })}
              </Badge>
            ),
          },
        }}
      />
    </div>
  );
};
