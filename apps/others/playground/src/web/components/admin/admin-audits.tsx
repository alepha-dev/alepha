import type { Page } from "alepha";
import type { AdminAuditController, AuditEntity } from "alepha/api/audits";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useCallback } from "react";
import { AlephaTable } from "@/web/components/alepha-table";
import { Badge } from "@/web/components/ui/badge";

export function AdminAudits() {
  const client = useClient<AdminAuditController>();
  const { l } = useI18n();

  const fetcher = useCallback(
    async (params: { page: number; size: number; sort?: string }) => {
      const res = await client.findAudits({ query: params as never });
      return res as Page<AuditEntity>;
    },
    [client],
  );

  return (
    <div className="p-6">
      <AlephaTable<AuditEntity>
        fetch={fetcher}
        header={
          <div>
            <h1 className="text-lg font-semibold">Audit log</h1>
            <p className="text-muted-foreground text-sm">
              Read-only history of API actions and resource changes.
            </p>
          </div>
        }
        columns={{
          createdAt: {
            label: "When",
            sortable: true,
            cell: (a) => (
              <span className="text-muted-foreground text-xs">
                {String(l(a.createdAt, { date: "fromNow" }))}
              </span>
            ),
          },
          action: {
            label: "Action",
            cell: (a) => (
              <code className="text-xs font-medium">{a.action}</code>
            ),
          },
          resource: {
            label: "Resource",
            cell: (a) => (
              <span className="font-mono text-xs">
                {a.resourceType
                  ? `${a.resourceType}:${a.resourceId ?? "—"}`
                  : "—"}
              </span>
            ),
          },
          actor: {
            label: "Actor",
            cell: (a) => (
              <span className="text-sm">
                {(a as any).userEmail ?? (a as any).userId ?? "—"}
              </span>
            ),
          },
          status: {
            label: "Status",
            cell: (a) => (
              <Badge variant={a.success ? "default" : "destructive"}>
                {a.success ? "OK" : "Failed"}
              </Badge>
            ),
          },
        }}
      />
    </div>
  );
}
