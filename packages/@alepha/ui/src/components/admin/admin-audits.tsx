import { AlephaTable } from "@alepha/ui/components/alepha-table";
import { Badge } from "@alepha/ui/components/ui/badge";
import type { Page } from "alepha";
import type { AdminAuditController, AuditEntity } from "alepha/api/audits";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useCallback } from "react";

export function AdminAudits() {
  const client = useClient<AdminAuditController>();
  const { l, tr } = useI18n();

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
            <h1 className="text-lg font-semibold">
              {tr("admin.audits.title", { default: "Audit log" })}
            </h1>
            <p className="text-muted-foreground text-sm">
              {tr("admin.audits.subtitle", {
                default:
                  "Read-only history of API actions and resource changes.",
              })}
            </p>
          </div>
        }
        columns={{
          createdAt: {
            label: tr("admin.audits.colWhen", { default: "When" }),
            sortable: true,
            cell: (a) => (
              <span className="text-muted-foreground text-xs">
                {String(l(a.createdAt, { date: "fromNow" }))}
              </span>
            ),
          },
          action: {
            label: tr("admin.audits.colAction", { default: "Action" }),
            cell: (a) => (
              <code className="text-xs font-medium">{a.action}</code>
            ),
          },
          resource: {
            label: tr("admin.audits.colResource", { default: "Resource" }),
            cell: (a) => (
              <span className="font-mono text-xs">
                {a.resourceType
                  ? `${a.resourceType}:${a.resourceId ?? "—"}`
                  : "—"}
              </span>
            ),
          },
          actor: {
            label: tr("admin.audits.colActor", { default: "Actor" }),
            cell: (a) => (
              <span className="text-sm">
                {(a as any).userEmail ?? (a as any).userId ?? "—"}
              </span>
            ),
          },
          status: {
            label: tr("admin.audits.colStatus", { default: "Status" }),
            cell: (a) => (
              <Badge variant={a.success ? "default" : "destructive"}>
                {a.success
                  ? tr("admin.audits.ok", { default: "OK" })
                  : tr("admin.audits.failed", { default: "Failed" })}
              </Badge>
            ),
          },
        }}
      />
    </div>
  );
}
